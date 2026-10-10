import { Platform } from 'react-native';

const envServerUrl = (process.env.EXPO_PUBLIC_SERVER_URL ?? '').replace(/\/$/, '');

/**
 * The PC server. On a phone this is the LAN or ngrok URL from .env. In a browser on the same
 * computer, talk to localhost instead: Chrome holds requests from localhost to LAN addresses
 * behind a Local Network Access permission, which made the page load with no data.
 */
function resolveServerUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    const port = envServerUrl.match(/:(\d+)$/)?.[1] ?? '3000';
    return `http://localhost:${port}`;
  }
  return envServerUrl;
}

export const SERVER_URL = resolveServerUrl();
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const supabaseEnabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Google Maps. The key is used by the browser map and Places search (restrict it to your
 * domains/app IDs in Google Cloud). Phones in Expo Go show Google Maps (Android) or Apple Maps
 * (iOS) without it. The Map ID turns on vector rendering — tilt, rotation and 3D buildings;
 * Google's DEMO_MAP_ID works for testing.
 */
export const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
export const GOOGLE_MAP_ID = process.env.EXPO_PUBLIC_GOOGLE_MAP_ID || 'DEMO_MAP_ID';

/** Absolute URL for a server path such as a render's /tiles/... LOD file. Supabase URLs pass through. */
export const serverUrl = (p: string) => (/^https?:/.test(p) ? p : `${SERVER_URL}${p}`);
