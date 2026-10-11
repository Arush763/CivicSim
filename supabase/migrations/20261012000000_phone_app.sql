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
