-- Apply once to the EXISTING CivicSim project. Preserves existing data.
-- Only phone-app and cloud-request upgrades; setup.sql is for EMPTY projects.

begin;

-- 20261012000000_phone_app.sql
-- The residents' phone app: Feed, Ranks and petitions with snapshots.
--
-- 1. Each request lists the still pictures the PC server took of it (proposals.snapshots), and a
--    petition shows the 2–4 its author picked, with a line on why to sign.
-- 2. The Feed reads one view (proposal_feed): author, petition, where the zone is, and a "Hot" score.
-- 3. Ranks: leaderboards for "Near me" and "This month", and your own numbers.

-- ---------------------------------------------------------------- snapshots
-- [{ kind, label, url }], written by the server (service key) while it prepares the photo-real views.
alter table public.proposals
  add column if not exists snapshots jsonb not null default '[]';

alter table public.petitions
  add column if not exists reason text not null default '' check (char_length(reason) <= 500),
  add column if not exists snapshots text[] not null default '{}'
    check (cardinality(snapshots) = 0 or cardinality(snapshots) between 2 and 4);
revoke insert on public.petitions from authenticated, anon;
grant insert (proposal_id, created_by, goal, reason, snapshots) on public.petitions to authenticated;

-- ---------------------------------------------------------------- notification preference
alter table public.profiles
  add column if not exists notify_updates boolean not null default true;
revoke update on public.profiles from authenticated, anon;
grant update (username, notify_updates) on public.profiles to authenticated;

-- ---------------------------------------------------------------- the Feed
-- "Hot": net votes on a log scale, plus a steady climb for newer requests (Reddit's formula). It's
-- fixed for each row, so the order doesn't depend on when you ask.
create or replace function public.hot_score(score integer, created_at timestamptz) returns double precision
language sql stable as $$
  select sign(score) * log(greatest(abs(score), 1)) + (extract(epoch from created_at) - 1134028003) / 45000.0
$$;

-- Zone boxes are [west, south, east, north]; lng/lat is the zone's centre, for "Near me".
create or replace view public.proposal_feed with (security_invoker = true) as
  select
    p.*,
    public.hot_score(p.score, p.created_at) as hot,
    (a.bbox[1] + a.bbox[3]) / 2 as lng,
    (a.bbox[2] + a.bbox[4]) / 2 as lat,
    a.name as area_name,
    jsonb_build_object('username', pr.username, 'rank', pr.rank) as author,
    (
      select jsonb_build_object(
        'id', pt.id, 'goal', pt.goal, 'signature_count', pt.signature_count, 'status', pt.status,
        'reason', pt.reason, 'snapshots', pt.snapshots, 'created_at', pt.created_at
      )
      from public.petitions pt where pt.proposal_id = p.id
    ) as petition
  from public.proposals p
  join public.areas a on a.id = p.area_id
  left join public.profiles pr on pr.id = p.author_id;

-- ---------------------------------------------------------------- Ranks
-- Points events are private to each person, so these add them up in the database and hand back
-- only names, ranks and totals.

-- Points earned this calendar month, everywhere.
create or replace function public.leaderboard_month()
returns table (id uuid, username text, rank text, points bigint, "position" bigint)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.username, pr.rank, sum(e.points)::bigint, rank() over (order by sum(e.points) desc)
    from public.point_events e
    join public.profiles pr on pr.id = e.user_id
   where e.created_at >= date_trunc('month', now())
   group by pr.id, pr.username, pr.rank
   order by 4 desc
   limit 50
$$;

-- Points earned from requests (and their petitions) in zones within `km` of a place.
create or replace function public.leaderboard_near(lng double precision, lat double precision, km double precision default 5)
returns table (id uuid, username text, rank text, points bigint, "position" bigint)
language sql stable security definer set search_path = public as $$
  with near as (
    select p.id
      from public.proposals p
      join public.areas a on a.id = p.area_id
     where abs((a.bbox[2] + a.bbox[4]) / 2 - lat) * 111.195 <= km
       and abs((a.bbox[1] + a.bbox[3]) / 2 - lng) * 111.195 * cos(radians(lat)) <= km
  ), refs as (
    select near.id from near
    union
    select pt.id from public.petitions pt where pt.proposal_id in (select near.id from near)
  )
  select pr.id, pr.username, pr.rank, sum(e.points)::bigint, rank() over (order by sum(e.points) desc)
    from public.point_events e
    join public.profiles pr on pr.id = e.user_id
   where e.ref_id in (select refs.id from refs)
   group by pr.id, pr.username, pr.rank
   order by 4 desc
   limit 50
$$;

-- Your own numbers for the "My rank" card.
create or replace function public.my_stats()
returns table (requests bigint, upvotes bigint, signed bigint)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.proposals where author_id = auth.uid()),
    (select coalesce(sum(confirm_count), 0)::bigint from public.proposals where author_id = auth.uid()),
    (select count(*) from public.petition_signatures where user_id = auth.uid())
$$;

-- 20261013000000_cloud_requests.sql
-- Phones save small drafts and submissions in the cloud. The laptop leases jobs through RPC;
-- no inbound connection or tunnel is needed for submission or viewing saved snapshots.
create table public.zone_scenes (
  area_id text primary key references public.areas(id) on delete cascade,
  detail jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.zone_scenes enable row level security;
create policy "read zone scenes" on public.zone_scenes for select using (true);
grant select on public.zone_scenes to anon, authenticated;
revoke insert, update, delete on public.zone_scenes from anon, authenticated;

create table public.request_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  area_id text not null references public.areas(id),
  title text not null check (char_length(title) between 3 and 120),
  description text not null default '' check (char_length(description) <= 4000),
  ops jsonb not null default '[]' check (jsonb_typeof(ops) = 'array' and jsonb_array_length(ops) <= 50 and octet_length(ops::text) <= 100000),
  submitted_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.request_drafts enable row level security;
create policy "read own request drafts" on public.request_drafts for select using (owner_id = auth.uid());
create policy "create own request drafts" on public.request_drafts for insert with check (owner_id = auth.uid() and submitted_at is null);
create policy "edit own unsubmitted drafts" on public.request_drafts for update
  using (owner_id = auth.uid() and submitted_at is null) with check (owner_id = auth.uid() and submitted_at is null);
create policy "delete own unsubmitted drafts" on public.request_drafts for delete using (owner_id = auth.uid() and submitted_at is null);
revoke all on public.request_drafts from anon, authenticated;
grant select, delete on public.request_drafts to authenticated;
grant insert (id, area_id, title, description, ops) on public.request_drafts to authenticated;
grant update (title, description, ops, updated_at) on public.request_drafts to authenticated;

create table public.cloud_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('zone', 'proposal')),
  ref text not null,
  requested_by uuid references public.profiles(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  leased_until timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(kind, ref)
);
create index cloud_jobs_ready on public.cloud_jobs(status, available_at);
alter table public.cloud_jobs enable row level security;
revoke all on public.cloud_jobs from anon, authenticated;
-- Only the service key claims, renews and completes work. Explicit grants also support projects
-- with hardened default privileges.
grant all on public.cloud_jobs, public.zone_scenes, public.request_drafts to service_role;

-- Recreate p.* after adding processing status so the existing feed exposes it.
alter table public.proposals add column if not exists processing_status text not null default 'ready'
  check (processing_status in ('queued', 'running', 'ready', 'failed'));
alter table public.proposals add column if not exists processing_error text;
-- PostgreSQL requires new view columns to be appended, preserving the existing feed's order.
do $$
declare cols text;
begin
  select string_agg('p.' || quote_ident(attname), ', ' order by attnum) into cols
  from pg_attribute where attrelid = 'public.proposals'::regclass and attnum > 0 and not attisdropped
    and attname not in ('processing_status', 'processing_error');
  execute 'create or replace view public.proposal_feed with (security_invoker = true) as select ' || cols || ',
    public.hot_score(p.score, p.created_at) as hot,
    (a.bbox[1] + a.bbox[3]) / 2 as lng, (a.bbox[2] + a.bbox[4]) / 2 as lat, a.name as area_name,
    jsonb_build_object(''username'', pr.username, ''rank'', pr.rank) as author,
    (select jsonb_build_object(''id'', pt.id, ''goal'', pt.goal, ''signature_count'', pt.signature_count,
      ''status'', pt.status, ''reason'', pt.reason, ''snapshots'', pt.snapshots, ''created_at'', pt.created_at)
      from public.petitions pt where pt.proposal_id = p.id) as petition,
    p.processing_status, p.processing_error
    from public.proposals p join public.areas a on a.id = p.area_id
    left join public.profiles pr on pr.id = p.author_id';
end $$;
grant select on public.proposal_feed to anon, authenticated;

create or replace function public.request_zone(p_area_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in to load a new zone'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if p_area_id !~ '^(g[0-9]{1,8}_[0-9]{1,8}|r[0-9]{2}c[0-9]{2})$' then raise exception 'Invalid zone'; end if;
  if exists (select 1 from zone_scenes where area_id = p_area_id) then return; end if;
  -- A single unique job per zone; opening the same zone twice cannot multiply work.
  if (select count(*) from cloud_jobs where kind = 'zone' and requested_by = auth.uid() and status in ('queued', 'running')) >= 10 then
    raise exception 'Too many zones waiting to load';
  end if;
  insert into cloud_jobs(kind, ref, requested_by) values ('zone', p_area_id, auth.uid()) on conflict (kind, ref) do nothing;
end $$;
revoke all on function public.request_zone(text) from public;
grant execute on function public.request_zone(text) to authenticated;

-- Submitting twice (including after a network timeout) returns the same proposal. Ownership is
-- checked under a row lock and proposal creation + job creation happen in one transaction.
create or replace function public.submit_request(p_draft_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d request_drafts;
begin
  select * into d from request_drafts where id = p_draft_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Draft not found'; end if;
  if d.submitted_at is not null then return d.id; end if;
  perform pg_advisory_xact_lock(hashtextextended(d.owner_id::text, 0));
  if jsonb_array_length(d.ops) = 0 or octet_length(d.ops::text) > 100000 then raise exception 'Invalid changes'; end if;
  if exists(select 1 from jsonb_array_elements(d.ops) op where jsonb_typeof(op) <> 'object'
    or coalesce(op->>'type', '') not in ('add_bike_lane','add_bus_lane','add_park','plant_trees',
      'replace_building','widen_sidewalk','add_crosswalk','remove_parking')) then raise exception 'Invalid change type'; end if;
  -- Cost and geometry are verified by the worker; an empty cost never means a free project.
  if (select count(*) from proposals where author_id = d.owner_id and processing_status in ('queued', 'running')) >= 10 then
    raise exception 'You already have 10 requests waiting for processing';
  end if;
  insert into proposals(id, area_id, author_id, title, description, ops, cost, source, processing_status, photo_status)
    values(d.id, d.area_id, d.owner_id, d.title, d.description, d.ops, '{}', 'human', 'queued', 'queued');
  insert into cloud_jobs(kind, ref) values ('proposal', d.id::text);
  update request_drafts set submitted_at = now(), updated_at = now() where id = d.id;
  return d.id;
end $$;
revoke all on function public.submit_request(uuid) from public;
grant execute on function public.submit_request(uuid) to authenticated;

create or replace function public.claim_cloud_job() returns setof public.cloud_jobs
language sql security definer set search_path = public as $$
  update cloud_jobs set status = 'running', lease_token = gen_random_uuid(),
    leased_until = now() + interval '90 seconds', attempts = attempts + 1, updated_at = now()
  where id = (select id from cloud_jobs
    where (status = 'queued' and available_at <= now()) or (status = 'running' and leased_until < now())
    order by case when kind = 'zone' then 0 else 1 end, created_at
    for update skip locked limit 1)
  returning *
$$;
create or replace function public.renew_cloud_job(p_id uuid, p_token uuid) returns boolean
language sql security definer set search_path = public as $$
  with renewed as (update cloud_jobs set leased_until = now() + interval '90 seconds', updated_at = now()
    where id = p_id and lease_token = p_token and status = 'running' and leased_until > now() returning id)
  select exists(select 1 from renewed)
$$;
create or replace function public.finish_cloud_job(p_id uuid, p_token uuid, p_error text default null, p_retry_at timestamptz default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare j cloud_jobs; next_status text;
begin
  select * into j from cloud_jobs where id = p_id and lease_token = p_token and status = 'running'
    and leased_until > now() for update;
  if not found then return false; end if;
  next_status := case when p_error is null then 'done' when j.attempts < 5 or p_retry_at is not null then 'queued' else 'failed' end;
  update cloud_jobs set status = next_status, error = left(p_error, 300), lease_token = null, leased_until = null,
    available_at = coalesce(p_retry_at, now() + make_interval(secs => least(900, 15 * power(2, j.attempts)::int))),
    attempts = case when p_retry_at is not null then greatest(0, attempts - 1) else attempts end, updated_at = now() where id = j.id;
  if j.kind = 'proposal' and p_error is not null then
    update proposals set processing_status = case when next_status = 'failed' then 'failed' else 'queued' end,
      processing_error = left(p_error, 300), photo_status = case when next_status = 'failed' then 'failed' else 'queued' end
      where id = j.ref::uuid;
  end if;
  return true;
end $$;
revoke all on function public.claim_cloud_job(), public.renew_cloud_job(uuid, uuid),
  public.finish_cloud_job(uuid, uuid, text, timestamptz) from public;
grant execute on function public.claim_cloud_job(), public.renew_cloud_job(uuid, uuid),
  public.finish_cloud_job(uuid, uuid, text, timestamptz) to service_role;

-- Run our schema validator before spending money. The laptop never trusts phone-supplied
-- costs, AI settings, user ids or output URLs.
comment on table public.cloud_jobs is 'Durable leased laptop work; clients submit via submit_request only.';

create or replace function public.retry_cloud_request(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from proposals where id=p_id) then raise exception 'Request not found'; end if;
  insert into cloud_jobs(kind,ref) values('proposal',p_id::text)
    on conflict(kind,ref) do update set status='queued', attempts=0, available_at=now(), error=null,
      lease_token=null, leased_until=null, updated_at=now() where cloud_jobs.status <> 'running';
  if not found then return false; end if;
  update proposals set processing_status='queued', processing_error=null, photo_status='queued' where id=p_id;
  return true;
end $$;
revoke all on function public.retry_cloud_request(uuid) from public;
grant execute on function public.retry_cloud_request(uuid) to service_role;

-- Realtime makes requests appear in the laptop panel. Polling still reconciles missed events.
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and
     not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='proposals') then
    alter publication supabase_realtime add table public.proposals;
  end if;
end $$;

-- 20261014000000_harden_cloud_functions.sql
-- Supabase grants execute on new functions to anon and authenticated directly, so revoking from
-- "public" alone left the worker's queue functions callable from the apps. Only the laptop
-- (service key) claims, renews, finishes and retries jobs.
revoke execute on function public.claim_cloud_job(), public.renew_cloud_job(uuid, uuid),
  public.finish_cloud_job(uuid, uuid, text, timestamptz), public.retry_cloud_request(uuid)
  from public, anon, authenticated;
-- Loading a zone and submitting need a signed-in person.
revoke execute on function public.request_zone(text), public.submit_request(uuid) from anon;
alter function public.hot_score(integer, timestamptz) set search_path = public;

commit;
