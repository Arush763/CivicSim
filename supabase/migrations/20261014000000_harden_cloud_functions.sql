-- Supabase grants execute on new functions to anon and authenticated directly, so revoking from
-- "public" alone left the worker's queue functions callable from the apps. Only the laptop
-- (service key) claims, renews, finishes and retries jobs.
revoke execute on function public.claim_cloud_job(), public.renew_cloud_job(uuid, uuid),
  public.finish_cloud_job(uuid, uuid, text, timestamptz), public.retry_cloud_request(uuid)
  from public, anon, authenticated;
-- Loading a zone and submitting need a signed-in person.
revoke execute on function public.request_zone(text), public.submit_request(uuid) from anon;
alter function public.hot_score(integer, timestamptz) set search_path = public;
