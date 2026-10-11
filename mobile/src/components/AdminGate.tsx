import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';
import AccountScreen from '@/app/(tabs)/account';
import { useAuth } from '@/lib/auth';
import { useAdminState } from '@/lib/data';
import { useTheme } from '@/lib/theme';
import { Notice, pageColumn } from './ui';

/**
 * In a browser this app is the city admin panel, run on the server computer, so with Supabase on
 * only admins get past the sign-in. (In local-only mode, whoever is at the computer is the admin.)
 * The phone app is separate and only makes requests.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const t = useTheme();
  const { devMode, session, ready } = useAuth();
  const admin = useAdminState();
  if (Platform.OS !== 'web' || devMode) return <>{children}</>;
  if (!ready || (session && admin === 'checking')) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  if (session && admin === 'admin') return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ ...pageColumn, paddingBottom: 0 }}>
        <Notice kind={session ? 'error' : 'info'}>
          {session
            ? 'This account is not a city admin. This panel is for city admins only; residents make requests in the phone app.'
            : 'City admin panel. Sign in with a city admin account to continue.'}
        </Notice>
      </View>
      <AccountScreen />
    </View>
  );
}
