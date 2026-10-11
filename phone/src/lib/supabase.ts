import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseEnabled } from './config';

/** Anon-key client. Row-level security decides what it can do; the service key stays on the laptop. */
export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    })
  : null;
