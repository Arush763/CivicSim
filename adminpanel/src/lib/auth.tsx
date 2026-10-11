import { supabase } from './supabase';

/**
 * The admin panel has no accounts. It runs in a browser on the server computer, and the server
 * treats whoever uses it there as the city admin (phones are never admin), so nothing here signs in.
 */
const PANEL = {
  /** Local-only dev mode: no Supabase. */
  devMode: !supabase,
  /** Nobody is signed in to the panel. */
  userId: null as string | null,
  /** No token: the server recognises the panel by where it runs. */
  token: async (): Promise<string | null> => null,
};

export function useAuth() {
  return PANEL;
}
