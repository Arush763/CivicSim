import { APIProvider } from '@vis.gl/react-google-maps';
import type { ReactNode } from 'react';
import { GOOGLE_MAPS_KEY } from '@/lib/config';

/** Loads the Google Maps JavaScript API once for every map and for Places search. */
export function MapsProvider({ children }: { children: ReactNode }) {
  return (
    <APIProvider apiKey={GOOGLE_MAPS_KEY} libraries={['places', 'marker']}>
      {children}
    </APIProvider>
  );
}
