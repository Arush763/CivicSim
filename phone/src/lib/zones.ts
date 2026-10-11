import type { Area } from '@mamdani/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { api } from './api';
import { fetchAllRequests, netScore, type Proposal } from './data';

export const isWaiting = (p: Proposal) => p.status === 'submitted' || p.status === 'under_review';

export interface ZoneSummary {
  waiting: number;
  approved: number;
  total: number;
  /** The most upvoted request here. */
  top: Proposal | null;
  name: string | null;
}

let areaCache: Area[] = [];

/**
 * Every request, grouped by zone, plus the names of zones the server has loaded. Refreshed each
 * time the screen comes back into view (a request may have been made in between).
 */
export function useZoneRequests() {
  const [requests, setRequests] = useState<Proposal[]>([]);
  const [areas, setAreas] = useState<Area[]>(areaCache);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRequests(await fetchAllRequests());
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
    api(async () => null)
      .areas()
      .then((a) => {
        areaCache = a;
        setAreas(a);
      })
      .catch(() => {});
  }, []);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return useMemo(() => {
    const names = new Map(areas.map((a) => [a.id, a.name]));
    const byZone: Record<string, ZoneSummary> = {};
    for (const r of requests) {
      const z = (byZone[r.area_id] ??= { waiting: 0, approved: 0, total: 0, top: null, name: r.area_name ?? names.get(r.area_id) ?? null });
      z.total++;
      if (isWaiting(r)) z.waiting++;
      if (r.status === 'accepted') z.approved++;
      if (!z.top || netScore(r) > netScore(z.top)) z.top = r;
    }
    return { requests, byZone, names, areas, error, refresh };
  }, [requests, areas, error, refresh]);
}
