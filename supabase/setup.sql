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
