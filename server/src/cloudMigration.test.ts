import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const sql = readFileSync(new URL('../../supabase/setup.sql', import.meta.url), 'utf8');
describe('cloud submissions and worker leases', () => {
  const db = new PGlite();
  let draftId: string;
  let firstLease: { id: string; lease_token: string };
  beforeAll(async () => {
    await db.exec(`
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
    `);
    await db.exec(sql);
    await db.query('insert into auth.users(id,email) values ($1,$2),($3,$4)', [A, 'a@example.test', B, 'b@example.test']);
    await db.exec(`insert into areas(id,name,bbox) values ('r00c00','Test','{-74,40.7,-73.9,40.8}');`);
  }, 30_000);

  const asUser = async <T>(id: string, fn: () => Promise<T>) => {
    await db.exec(`set role authenticated; set request.jwt.sub = '${id}';`);
    try { return await fn(); } finally { await db.exec('reset role; reset request.jwt.sub;'); }
  };

  it('saves drafts and submits atomically while no worker is running', async () => {
    draftId = await asUser(A, async () => {
      const { rows } = await db.query<{ id: string }>(`insert into request_drafts(area_id,title,ops)
        values ('r00c00','New crosswalk','[{"type":"add_crosswalk","at":[-74,40.72],"raised":false}]') returning id`);
      return rows[0].id;
    });
    await asUser(A, async () => {
      const a = await db.query<{ id: string }>('select submit_request($1) as id', [draftId]);
      const b = await db.query<{ id: string }>('select submit_request($1) as id', [draftId]);
      expect(a.rows[0].id).toBe(draftId);
      expect(b.rows[0].id).toBe(draftId);
    });
    expect((await db.query('select count(*)::int as n from proposals')).rows[0]).toEqual({ n: 1 });
    expect((await db.query('select count(*)::int as n from cloud_jobs')).rows[0]).toEqual({ n: 1 });
    expect((await db.query('select points from profiles where id=$1', [A])).rows[0]).toEqual({ points: 10 });
    expect((await db.query('select processing_status from proposal_feed')).rows[0]).toEqual({ processing_status: 'queued' });
  });

  it('blocks impersonation, editing a submitted draft, output URLs and claiming work', async () => {
    await asUser(B, async () => {
      expect((await db.query('select * from request_drafts')).rows).toEqual([]);
      await expect(db.query('select submit_request($1)', [draftId])).rejects.toThrow('Draft not found');
      await expect(db.query(`insert into request_drafts(owner_id,area_id,title) values ($1,'r00c00','Forged')`, [A])).rejects.toThrow(/permission denied/);
      await expect(db.query('select claim_cloud_job()')).rejects.toThrow(/permission denied/);
      await expect(db.query(`update proposals set processing_status='ready', after_url='https://fake'`)).rejects.toThrow(/permission denied/);
    });
    await asUser(A, async () => {
      expect((await db.query('update request_drafts set title=$1 where id=$2', ['Changed', draftId])).affectedRows).toBe(0);
    });
  });

  it('leases a job once and fences out an old worker after laptop crash recovery', async () => {
    await db.exec('set role service_role;');
    try {
      const claimed = await db.query<{ id: string; lease_token: string }>('select * from claim_cloud_job()');
      firstLease = claimed.rows[0];
      expect((await db.query('select * from claim_cloud_job()')).rows).toEqual([]);
      expect((await db.query('select renew_cloud_job($1,$2) as ok', [firstLease.id, firstLease.lease_token])).rows[0]).toEqual({ ok: true });
    } finally { await db.exec('reset role;'); }
    await db.query(`update cloud_jobs set leased_until=now()-interval '1 minute' where id=$1`, [firstLease.id]);
    await db.exec('set role service_role;');
    try {
      const lease = (await db.query<{ lease_token: string }>('select * from claim_cloud_job()')).rows[0];
      expect(lease.lease_token).not.toBe(firstLease.lease_token);
      expect((await db.query('select finish_cloud_job($1,$2) as ok', [firstLease.id, firstLease.lease_token])).rows[0]).toEqual({ ok: false });
      expect((await db.query('select finish_cloud_job($1,$2,$3) as ok', [firstLease.id, lease.lease_token, 'Temporary failure'])).rows[0]).toEqual({ ok: true });
    } finally { await db.exec('reset role;'); }
    expect((await db.query('select status from cloud_jobs where id=$1', [firstLease.id])).rows[0]).toEqual({ status: 'queued' });
  });

  it('deduplicates requests for a new zone and keeps cached scenes public', async () => {
    await asUser(A, async () => {
      await db.query('select request_zone($1)', ['g72680_44813']);
      await db.query('select request_zone($1)', ['g72680_44813']);
    });
    expect((await db.query(`select count(*)::int as n from cloud_jobs where kind='zone'`)).rows[0]).toEqual({ n: 1 });
    await db.exec(`insert into zone_scenes(area_id,detail) values('r00c00','{"id":"r00c00"}'); set role anon;`);
    try {
      expect((await db.query('select detail from zone_scenes')).rows[0]).toEqual({ detail: { id: 'r00c00' } });
      await expect(db.query(`insert into zone_scenes(area_id,detail) values('r00c00','{}')`)).rejects.toThrow(/permission denied/);
    } finally { await db.exec('reset role;'); }
  });
});
