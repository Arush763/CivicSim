import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useAuth } from './auth';
import { fetchProfile, type Profile } from './data';

let cached: Profile | null = null;

/** Your profile (name, points, rank), refreshed whenever a screen using it comes into view. */
export function useMe(): { me: Profile | null; refresh: () => Promise<void> } {
  const { userId, devMode } = useAuth();
  const [me, setMe] = useState<Profile | null>(cached?.id === userId ? cached : null);
  const refresh = useCallback(async () => {
    if (devMode || !userId) return;
    const p = await fetchProfile(userId).catch(() => null);
    if (p) {
      cached = p;
      setMe(p);
    }
  }, [userId, devMode]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  return { me, refresh };
}
