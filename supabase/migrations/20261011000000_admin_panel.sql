-- The city admin panel runs on the server computer; phones only make requests.
--
-- 1. Decisions on requests (accept / reject / reopen) now go through the PC server, which only
--    takes them from the admin panel on its own computer and writes them with the service key.
--    So nobody, not even an admin's phone, can change a status straight in the database.
-- 2. Each request records how far along its photo-real Street View views are, so any app can show
--    "Preparing…" or "Ready" without asking the server.

-- ---------------------------------------------------------------- decisions: server only
drop policy if exists "admin updates proposals" on public.proposals;
revoke update on public.proposals from authenticated, anon;

-- ---------------------------------------------------------------- photo-real status
alter table public.proposals
  add column if not exists photo_status text not null default 'none'
    check (photo_status in ('none', 'queued', 'running', 'done', 'failed', 'skipped')),
  add column if not exists photo_spots integer not null default 0,   -- Street View spots prepared
  add column if not exists photo_updated_at timestamptz;

create index if not exists proposals_status_idx on public.proposals(status, created_at desc);
