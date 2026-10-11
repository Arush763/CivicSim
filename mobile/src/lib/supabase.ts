import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseEnabled } from './config';

/**
 * Anon-key client. Row-level security decides what it can do; the service key lives only on the PC.
 * In the browser panel, the sign-in email's link also works: it lands on the panel (Supabase's Site
 * URL) and the session is read from the address. Phones use the 6-digit code.
 */
export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: Platform.OS === 'web' },
    })
  : null;
