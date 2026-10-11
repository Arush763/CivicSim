import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseEnabled } from './config';

/**
 * Anon-key client, for reading requests, petitions and ranks. Row-level security decides what it
 * can do; the service key lives only on the PC. The panel never signs in (decisions go through
 * the server), so no session is kept.
 */
export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;
