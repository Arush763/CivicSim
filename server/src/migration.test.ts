import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

// Minimal stand-ins for the parts of Supabase the migration touches.
const SUPABASE_STUBS = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema public, auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`;

// supabase/setup.sql is every migration in order (the one file to paste into Supabase).
const setupSql = readFileSync(fileURLToPath(new URL('../../supabase/setup.sql', import.meta.url)), 'utf8');

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';

describe('supabase migration', () => {
  const db = new PGlite();

  beforeAll(async () => {
    await db.exec(SUPABASE_STUBS);
    await db.exec(setupSql);
    await db.exec(`
      insert into auth.users (id, email) values ('${A}', 'alice@example.com'), ('${B}', 'bob@example.com');
      insert into areas (id, name, bbox) values ('r0c0', 'Test', '{-74,40.7,-73.99,40.71}');
    `);
  }, 30_000);

  const points = async (id: string) =>
    (await db.query<{ points: number; rank: string }>(`select points, rank from profiles where id = $1`, [id])).rows[0];

  it('creates profiles for new auth users', async () => {
    const r = await db.query<{ username: string }>(`select username from profiles order by username`);
    expect(r.rows.map((x) => x.username)).toEqual(['alice-0000', 'bob-0000']);
  });

  it('awards points across the proposal → vote → petition lifecycle', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into proposals (area_id, author_id, title, ops, cost) values ('r0c0', $1, 'Bike lane', '[]', '{}') returning id`,
      [A],
    );
    const pid = rows[0].id;
    expect((await points(A)).points).toBe(10);

    await db.query(`insert into proposal_votes (proposal_id, user_id, value) values ($1, $2, 1)`, [pid, B]);
    await db.query(`insert into proposal_votes (proposal_id, user_id, value) values ($1, $2, 1)`, [pid, A]); // self-vote: no points
    expect((await points(A)).points).toBe(12);
    expect((await db.query<{ score: number }>(`select score from proposals where id = $1`, [pid])).rows[0].score).toBe(2);

    await db.query(`update proposal_votes set value = -1 where proposal_id = $1 and user_id = $2`, [pid, B]);
    const tally = await db.query(`select score, confirm_count, deny_count from proposals where id = $1`, [pid]);
    expect(tally.rows[0]).toEqual({ score: 0, confirm_count: 1, deny_count: 1 });
    await db.query(`delete from proposal_votes where proposal_id = $1 and user_id = $2`, [pid, B]);
    const after = await db.query(`select score, confirm_count, deny_count from proposals where id = $1`, [pid]);
    expect(after.rows[0]).toEqual({ score: 1, confirm_count: 1, deny_count: 0 });

    const pet = await db.query<{ id: string }>(
      `insert into petitions (proposal_id, created_by, goal) values ($1, $2, 10) returning id`,
      [pid, A],
    );
    // Goal is 10; simulate 10 signers.
    for (let i = 0; i < 10; i++) {
      const uid = `00000000-0000-0000-0001-${String(i).padStart(12, '0')}`;
      await db.query(`insert into auth.users (id, email) values ($1, $2)`, [uid, `u${i}@example.com`]);
      await db.query(`insert into petition_signatures (petition_id, user_id) values ($1, $2)`, [pet.rows[0].id, uid]);
    }
    const p = await db.query<{ signature_count: number; status: string }>(
      `select signature_count, status from petitions where id = $1`,
      [pet.rows[0].id],
    );
    expect(p.rows[0]).toEqual({ signature_count: 10, status: 'goal_reached' });
    expect(await points(A)).toEqual({ points: 62, rank: 'Advocate' });

    await db.query(`update proposals set status = 'accepted' where id = $1`, [pid]);
    expect(await points(A)).toEqual({ points: 162, rank: 'Advocate' });
  });

  it('is up to date with the migrations', async () => {
    const { buildSetupSql, buildCloudUpgradeSql } = await import('../../scripts/supabase-sql.mjs');
    expect(setupSql).toBe(buildSetupSql());
    expect(readFileSync(fileURLToPath(new URL('../../supabase/cloud-upgrade.sql', import.meta.url)), 'utf8')).toBe(buildCloudUpgradeSql());
  });

  it('records how far along a request\'s photo-real views are', async () => {
    const r = await db.query<{ photo_status: string; photo_spots: number }>(`select photo_status, photo_spots from proposals limit 1`);
    expect(r.rows[0]).toEqual({ photo_status: 'none', photo_spots: 0 });
  });

  it('leaves decisions to the server, even for admins signed in on a phone', async () => {
    await db.query(`update profiles set role = 'admin' where id = $1`, [B]);
    await db.exec(`set role authenticated; set request.jwt.sub = '${B}';`);
    try {
      const r = await db.query(`update proposals set status = 'rejected' where author_id = $1`, [A]);
      expect(r.affectedRows ?? 0).toBe(0); // the update rule lets no app change a status
    } finally {
      await db.exec(`reset role; reset request.jwt.sub;`);
      await db.query(`update profiles set role = 'resident' where id = $1`, [B]);
    }
  });

  it('blocks residents from editing points or approving proposals', async () => {
    await db.exec(`set role authenticated; set request.jwt.sub = '${B}';`);
    try {
      await expect(db.query(`update profiles set points = 9999 where id = $1`, [B])).rejects.toThrow(/permission denied/);
      const r = await db.query(`update proposals set status = 'accepted' where author_id = $1`, [A]);
      expect(r.affectedRows ?? 0).toBe(0);
      await expect(
        db.query(`insert into proposal_votes (proposal_id, user_id, value) select id, $1, 1 from proposals limit 1`, [A]),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await db.exec(`reset role; reset request.jwt.sub;`);
    }
  });

  it('exposes a ranked leaderboard view', async () => {
    const r = await db.query<{ username: string; position: string }>(`select username, position from leaderboard limit 1`);
    expect(r.rows[0].username).toBe('alice-0000');
    expect(Number(r.rows[0].position)).toBe(1);
  });

  it('feeds the phone app: hot order, zone centre, author and petition', async () => {
    const r = await db.query<{ title: string; lng: number; lat: number; author: { username: string }; petition: { goal: number; reason: string } | null; hot: number }>(
      `select title, lng, lat, author, petition, hot from proposal_feed order by hot desc limit 1`,
    );
    expect(r.rows[0]).toMatchObject({ title: 'Bike lane', author: { username: 'alice-0000' }, petition: { goal: 10, reason: '' } });
    expect(r.rows[0].lng).toBeCloseTo(-73.995);
    expect(r.rows[0].lat).toBeCloseTo(40.705);
    // A newer request with the same votes ranks hotter.
    const hot = await db.query<{ older: number; newer: number }>(`select hot_score(1, now() - interval '2 days') as older, hot_score(1, now()) as newer`);
    expect(hot.rows[0].newer).toBeGreaterThan(hot.rows[0].older);
  });

  it('lets an author start a petition with 2–4 snapshots and a reason', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into proposals (area_id, author_id, title, ops, cost) values ('r0c0', $1, 'Street trees', '[]', '{}') returning id`,
      [B],
    );
    await db.exec(`set role authenticated; set request.jwt.sub = '${B}';`);
    try {
      await expect(
        db.query(`insert into petitions (proposal_id, created_by, goal, snapshots) values ($1, $2, 100, '{a}')`, [rows[0].id, B]),
      ).rejects.toThrow(/check constraint/);
      await db.query(
        `insert into petitions (proposal_id, created_by, goal, reason, snapshots) values ($1, $2, 100, 'Shade for the block', '{a,b}')`,
        [rows[0].id, B],
      );
      await db.query(`update profiles set notify_updates = false where id = $1`, [B]);
    } finally {
      await db.exec(`reset role; reset request.jwt.sub;`);
    }
    const pet = await db.query<{ reason: string; snapshots: string[] }>(`select reason, snapshots from petitions where proposal_id = $1`, [rows[0].id]);
    expect(pet.rows[0]).toEqual({ reason: 'Shade for the block', snapshots: ['a', 'b'] });
  });

  it('ranks people near a place and this month, and counts your own numbers', async () => {
    const near = await db.query<{ username: string; points: string }>(`select username, points from leaderboard_near(-73.995, 40.705, 5)`);
    expect(near.rows[0]).toMatchObject({ username: 'alice-0000' });
    expect((await db.query(`select * from leaderboard_near(2.35, 48.85, 5)`)).rows).toEqual([]); // Paris: nothing there
    const month = await db.query<{ username: string; position: string }>(`select username, position from leaderboard_month()`);
    expect(month.rows.map((x) => x.username)).toContain('bob-0000');
    await db.exec(`set role authenticated; set request.jwt.sub = '${A}';`);
    try {
      const me = await db.query<{ requests: string; upvotes: string; signed: string }>(`select * from my_stats()`);
      expect(me.rows[0]).toEqual({ requests: 1, upvotes: 1, signed: 0 });
    } finally {
      await db.exec(`reset role; reset request.jwt.sub;`);
    }
  });
});
