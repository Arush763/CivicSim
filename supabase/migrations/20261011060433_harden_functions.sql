-- Internal functions: only the database calls them (triggers and policies), never the apps.
alter function public.rank_for(integer) set search_path = public;
revoke execute on function public.apply_points(), public.handle_new_user(), public.on_proposal_insert(),
  public.on_proposal_status(), public.on_signature(), public.on_vote_change(), public.is_admin()
  from public, anon, authenticated;
