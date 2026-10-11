-- Each request records how far along its photo-real Street View views are, so any app can show
-- "Preparing…" or "Ready" without asking the server.
alter table public.proposals
  add column if not exists photo_status text not null default 'none'
    check (photo_status in ('none', 'queued', 'running', 'done', 'failed', 'skipped')),
  add column if not exists photo_spots integer not null default 0,   -- Street View spots prepared
  add column if not exists photo_updated_at timestamptz;

create index if not exists proposals_status_idx on public.proposals(status, created_at desc);
