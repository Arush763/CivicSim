import type { ReactNode } from 'react';

/** Phones use the platform map SDK directly; nothing to load. (Browser: MapsProvider.web.tsx.) */
export function MapsProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
