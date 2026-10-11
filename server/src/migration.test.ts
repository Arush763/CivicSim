import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

// Minimal stand-ins for the parts of Supabase the migration touches.
const SUPABASE_STUBS = `
  create role anon; create role authenticated;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema public to anon, authenticated;
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
    const { buildSetupSql } = await import('../../scripts/supabase-sql.mjs');
    expect(setupSql).toBe(buildSetupSql());
  });

  it('records how far along a request\'s photo-real views are', async () => {
    const r = await db.query<{ photo_status: string; photo_spots: number }>(`select photo_status, photo_spots from proposals limit 1`);
    expect(r.rows[0]).toEqual({ photo_status: 'none', photo_spots: 0 });
  });

  it('leaves decisions to the server, even for admins signed in on a phone', async () => {
    await db.query(`update profiles set role = 'admin' where id = $1`, [B]);
    await db.exec(`set role authenticated; set request.jwt.sub = '${B}';`);
    try {
      await expect(db.query(`update proposals set status = 'rejected' where author_id = $1`, [A])).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec(`reset role; reset request.jwt.sub;`);
      await db.query(`update profiles set role = 'resident' where id = $1`, [B]);
    }
  });

  it('blocks residents from editing points or approving proposals', async () => {
    await db.exec(`set role authenticated; set request.jwt.sub = '${B}';`);
    try {
      await expect(db.query(`update profiles set points = 9999 where id = $1`, [B])).rejects.toThrow(/permission denied/);
      await expect(db.query(`update proposals set status = 'accepted' where author_id = $1`, [A])).rejects.toThrow(/permission denied/);
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
});
