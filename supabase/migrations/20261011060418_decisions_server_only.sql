-- Decisions on requests (accept / reject / reopen) go through the PC server only, which takes them
-- from the admin panel on its own computer and writes them with the service key (which bypasses
-- row-level security). No app, not even an admin's phone, can change a status directly.
alter policy "admin updates proposals" on public.proposals using (false) with check (false);
comment on policy "admin updates proposals" on public.proposals is 'Disabled: decisions are written by the server only.';
