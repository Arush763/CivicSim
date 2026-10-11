/** The laptop server (ngrok URL, or its address on the same Wi-Fi). Set in phone/.env. */
export const SERVER_URL = (process.env.EXPO_PUBLIC_SERVER_URL ?? '').replace(/\/$/, '');
/** The laptop's address on its Wi-Fi (scripts/start.sh writes it). Much faster than ngrok when the phone is on the same network. */
export const LAN_SERVER_URL = (process.env.EXPO_PUBLIC_SERVER_LAN_URL ?? '').replace(/\/$/, '');
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const supabaseEnabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
/** Places search (Places API, New). */
export const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

/** Absolute URL for a server path (/tiles/…, /snapshots/…). Supabase Storage URLs pass through. */
export const serverUrl = (p: string) => (/^https?:/.test(p) ? p : `${SERVER_URL}${p}`);

/** "Near me": requests in zones within this many km. */
export const NEAR_KM = 5;
