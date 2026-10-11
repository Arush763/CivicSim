-- Mamdani AI: the whole Supabase database in one file.
-- Paste it into Supabase > SQL Editor > New query, and Run (on a new, empty project).
-- Generated from supabase/migrations by scripts/supabase-sql.mjs; edit the migrations, not this file.

-- ================================================================ 20261011055957_init.sql

-- Mamdani AI: shared data for confirmed proposals, petitions, votes and the leaderboard.
-- Drafts and the render queue live on the PC server; only confirmed items land here.


-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (char_length(username) between 2 and 32),
  points integer not null default 0,
  rank text not null default 'Resident',
  role text not null default 'resident' check (role in ('resident', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function public.rank_for(p integer) returns text
language sql immutable as $$
  select case
    when p >= 750 then 'Council Voice'
    when p >= 200 then 'Organizer'
    when p >= 50  then 'Advocate'
    else 'Resident'
  end
$$;

-- New auth user -> profile row (username from metadata or email prefix).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1) || '-' || substr(new.id::text, 1, 4))
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- areas + issues
create table public.areas (
  id text primary key,
  name text not null,
  bbox double precision[4] not null,
  issue_total integer not null default 0
);

create table public.area_issues (
  area_id text references public.areas(id) on delete cascade,
  category text not null,
  count integer not null,
  updated_at timestamptz not null default now(),
  primary key (area_id, category)
);

-- ---------------------------------------------------------------- proposals
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  area_id text not null references public.areas(id),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  description text not null default '',
  ops jsonb not null,
  cost jsonb not null,
  source text not null default 'human' check (source in ('human', 'ai_suggested')),
  status text not null default 'submitted'
    check (status in ('submitted', 'under_review', 'accepted', 'rejected')),
  before_url text,
  after_url text,
  thumb_url text,
  score integer not null default 0,        -- confirms minus denies
  confirm_count integer not null default 0, -- residents who want this change
  deny_count integer not null default 0,    -- residents who don't
  created_at timestamptz not null default now()
);
create index proposals_area_idx on public.proposals(area_id, created_at desc);

create table public.proposal_votes (
  proposal_id uuid references public.proposals(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (proposal_id, user_id)
);

-- ---------------------------------------------------------------- petitions
create table public.petitions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid unique not null references public.proposals(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  goal integer not null default 100 check (goal between 10 and 100000),
  signature_count integer not null default 0,
  status text not null default 'open' check (status in ('open', 'goal_reached', 'closed')),
  created_at timestamptz not null default now()
);

create table public.petition_signatures (
  petition_id uuid references public.petitions(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (petition_id, user_id)
);

-- ---------------------------------------------------------------- points ledger
create table public.point_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  points integer not null,
  ref_id uuid,
  created_at timestamptz not null default now()
);

create or replace function public.apply_points() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set points = points + new.points,
         rank = public.rank_for(points + new.points)
   where id = new.user_id;
  return new;
end $$;

create trigger point_events_apply after insert on public.point_events
  for each row execute function public.apply_points();

-- Points rules: submit +10, upvote received +2, sign +1, petition goal +50 (author), accepted +100 (author).
create or replace function public.on_proposal_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.point_events (user_id, kind, points, ref_id) values (new.author_id, 'proposal_submitted', 10, new.id);
  return new;
end $$;
create trigger proposals_points after insert on public.proposals
  for each row execute function public.on_proposal_insert();

create or replace function public.on_proposal_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'accepted' and old.status <> 'accepted' then
    insert into public.point_events (user_id, kind, points, ref_id) values (new.author_id, 'proposal_accepted', 100, new.id);
  end if;
  return new;
end $$;
create trigger proposals_status_points after update of status on public.proposals
  for each row execute function public.on_proposal_status();

create or replace function public.on_vote_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  new_v integer := case when tg_op <> 'DELETE' then new.value else 0 end;
  old_v integer := case when tg_op <> 'INSERT' then old.value else 0 end;
  pid uuid := coalesce(new.proposal_id, old.proposal_id);
  author uuid;
begin
  -- Residents confirm (+1) or deny (-1) a requested change; keep both tallies and the net score.
  update public.proposals
     set score = score + (new_v - old_v),
         confirm_count = confirm_count + (new_v = 1)::int - (old_v = 1)::int,
         deny_count = deny_count + (new_v = -1)::int - (old_v = -1)::int
   where id = pid
  returning author_id into author;
  -- Only a brand-new confirm earns the author points, and not for confirming your own request.
  if tg_op = 'INSERT' and new.value = 1 and author <> new.user_id then
    insert into public.point_events (user_id, kind, points, ref_id) values (author, 'upvote_received', 2, pid);
  end if;
  return null;
end $$;
create trigger proposal_votes_change after insert or update or delete on public.proposal_votes
  for each row execute function public.on_vote_change();

create or replace function public.on_signature() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p public.petitions;
  author uuid;
begin
  update public.petitions set signature_count = signature_count + 1
   where id = new.petition_id returning * into p;
  insert into public.point_events (user_id, kind, points, ref_id) values (new.user_id, 'petition_signed', 1, p.id);
  if p.status = 'open' and p.signature_count >= p.goal then
    update public.petitions set status = 'goal_reached' where id = p.id;
    select author_id into author from public.proposals where id = p.proposal_id;
    insert into public.point_events (user_id, kind, points, ref_id) values (author, 'petition_goal', 50, p.id);
  end if;
  return null;
end $$;
create trigger petition_signatures_insert after insert on public.petition_signatures
  for each row execute function public.on_signature();

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.areas enable row level security;
alter table public.area_issues enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_votes enable row level security;
alter table public.petitions enable row level security;
alter table public.petition_signatures enable row level security;
alter table public.point_events enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

-- Public read.
create policy "read profiles" on public.profiles for select using (true);
create policy "read areas" on public.areas for select using (true);
create policy "read issues" on public.area_issues for select using (true);
create policy "read proposals" on public.proposals for select using (true);
create policy "read votes" on public.proposal_votes for select using (true);
create policy "read petitions" on public.petitions for select using (true);
create policy "read signatures" on public.petition_signatures for select using (true);
create policy "read own points" on public.point_events for select using (user_id = auth.uid());

-- Profiles: users may rename themselves; points/rank/role are protected by a column grant below.
create policy "update own profile" on public.profiles for update using (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (username) on public.profiles to authenticated;

-- Proposals are inserted by the PC server with the service key after a human confirms.
-- Only admins change status.
create policy "admin updates proposals" on public.proposals for update using (public.is_admin());
revoke update on public.proposals from authenticated, anon;
grant update (status) on public.proposals to authenticated;

-- Votes: your own only.
create policy "vote insert" on public.proposal_votes for insert with check (user_id = auth.uid());
create policy "vote update" on public.proposal_votes for update using (user_id = auth.uid());
create policy "vote delete" on public.proposal_votes for delete using (user_id = auth.uid());

-- Petitions: the proposal author starts one; anyone signs once, as themselves.
create policy "petition create" on public.petitions for insert with check (
  created_by = auth.uid()
  and exists (select 1 from public.proposals where id = proposal_id and author_id = auth.uid())
);
revoke insert on public.petitions from authenticated, anon;
grant insert (proposal_id, created_by, goal) on public.petitions to authenticated;
create policy "sign" on public.petition_signatures for insert with check (user_id = auth.uid());

-- ---------------------------------------------------------------- leaderboard view
create view public.leaderboard with (security_invoker = true) as
  select id, username, points, rank, rank() over (order by points desc) as position
  from public.profiles
  order by points desc;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public) values ('renders', 'renders', true)
  on conflict (id) do nothing;
create policy "public read renders" on storage.objects for select using (bucket_id = 'renders');

-- ================================================================ 20261011060413_photo_status.sql

-- Each request records how far along its photo-real Street View views are, so any app can show
-- "Preparing…" or "Ready" without asking the server.
alter table public.proposals
  add column if not exists photo_status text not null default 'none'
    check (photo_status in ('none', 'queued', 'running', 'done', 'failed', 'skipped')),
  add column if not exists photo_spots integer not null default 0,   -- Street View spots prepared
  add column if not exists photo_updated_at timestamptz;

create index if not exists proposals_status_idx on public.proposals(status, created_at desc);

-- ================================================================ 20261011060418_decisions_server_only.sql

-- Decisions on requests (accept / reject / reopen) go through the PC server only, which takes them
-- from the admin panel on its own computer and writes them with the service key (which bypasses
-- row-level security). No app, not even an admin's phone, can change a status directly.
alter policy "admin updates proposals" on public.proposals using (false) with check (false);
comment on policy "admin updates proposals" on public.proposals is 'Disabled: decisions are written by the server only.';

-- ================================================================ 20261011060433_harden_functions.sql

-- Internal functions: only the database calls them (triggers and policies), never the apps.
alter function public.rank_for(integer) set search_path = public;
revoke execute on function public.apply_points(), public.handle_new_user(), public.on_proposal_insert(),
  public.on_proposal_status(), public.on_signature(), public.on_vote_change(), public.is_admin()
  from public, anon, authenticated;

-- ================================================================ 20261012000000_phone_app.sql

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

-- ================================================================ 20261013000000_cloud_requests.sql

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

-- ================================================================ 20261014000000_harden_cloud_functions.sql

-- Supabase grants execute on new functions to anon and authenticated directly, so revoking from
-- "public" alone left the worker's queue functions callable from the apps. Only the laptop
-- (service key) claims, renews, finishes and retries jobs.
revoke execute on function public.claim_cloud_job(), public.renew_cloud_job(uuid, uuid),
  public.finish_cloud_job(uuid, uuid, text, timestamptz), public.retry_cloud_request(uuid)
  from public, anon, authenticated;
-- Loading a zone and submitting need a signed-in person.
revoke execute on function public.request_zone(text), public.submit_request(uuid) from anon;
alter function public.hot_score(integer, timestamptz) set search_path = public;
