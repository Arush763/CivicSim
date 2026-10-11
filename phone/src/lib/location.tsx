import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Near } from './data';

interface NearMe {
  /** Where you are, once known. */
  near: Near | null;
  /** A short place name for it, e.g. "Lower Manhattan". */
  label: string | null;
  status: 'locating' | 'ready' | 'denied' | 'unavailable';
  /** Ask again (after a denial, or to refresh). */
  locate: () => Promise<Near | null>;
}

const Ctx = createContext<NearMe | null>(null);

/** The neighbourhood-sized name for a place: "Lower Manhattan", "SoHo", or the city. */
const placeName = (a: Location.LocationGeocodedAddress | undefined) => a?.district || a?.subregion || a?.city || a?.region || null;

/** "Near me" for the Feed and Ranks, and the map's starting point. Asks for location once. */
export function NearMeProvider({ children }: { children: ReactNode }) {
  const [near, setNear] = useState<Near | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [status, setStatus] = useState<NearMe['status']>('locating');

  const locate = useCallback(async () => {
    try {
      setStatus('locating');
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setStatus('denied');
        return null;
      }
      const pos = (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 })) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      const here = { lng: pos.coords.longitude, lat: pos.coords.latitude };
      setNear(here);
      setStatus('ready');
      Location.reverseGeocodeAsync({ latitude: here.lat, longitude: here.lng })
        .then((r) => setLabel(placeName(r[0])))
        .catch(() => {});
      return here;
    } catch {
      setStatus('unavailable');
      return null;
    }
  }, []);

  useEffect(() => {
    void locate();
  }, [locate]);

  const value = useMemo(() => ({ near, label, status, locate }), [near, label, status, locate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNearMe(): NearMe {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNearMe must be used inside NearMeProvider');
  return ctx;
}
