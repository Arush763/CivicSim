import { useCallback, useEffect, useMemo, useState } from 'react';
import { zoneBbox, type Area } from '@mamdani/shared';
import { api } from './api';
import { fetchProposals, type Proposal } from './data';

export type ZoneState = 'waiting' | 'approved';

let areasPromise: Promise<Area[]> | null = null;

/**
 * Zones the server has loaded so far (names and boxes). Zones anywhere in the world are loaded
 * the first time someone opens them, so call `refresh` when coming back to a list.
 */
export function useAreas() {
  const [areas, setAreas] = useState<Area[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const load = useCallback((fresh = false) => {
    if (fresh) areasPromise = null;
    areasPromise ??= api(async () => null).areas();
    areasPromise.then(setAreas).catch((e) => {
      areasPromise = null;
      setError(e);
    });
  }, []);
  useEffect(() => load(), [load]);
  return { areas, error, refresh: () => load(true) };
}

/** A zone's box: computed from its id on the worldwide grid, or looked up for older pilot zones. */
export const areaBbox = (id: string, areas: Area[] | null): [number, number, number, number] | null =>
  zoneBbox(id) ?? areas?.find((a) => a.id === id)?.bbox ?? null;

export const zoneCenter = (bbox: [number, number, number, number]): [number, number] => [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

export const isWaiting = (p: Proposal) => p.status === 'submitted' || p.status === 'under_review';

export interface ZoneSummary {
  waiting: number;
  approved: number;
  total: number;
}

/** Requests grouped by zone, and the colour state each zone shows on the map. */
export function useZoneRequests() {
  const [requests, setRequests] = useState<Proposal[]>([]);
  const refresh = useCallback(async () => {
    try {
      setRequests(await fetchProposals());
    } catch {
      /* keep the last good list; screens show their own errors */
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return useMemo(() => {
    const byZone: Record<string, ZoneSummary> = {};
    for (const r of requests) {
      const z = (byZone[r.area_id] ??= { waiting: 0, approved: 0, total: 0 });
      z.total++;
      if (isWaiting(r)) z.waiting++;
      if (r.status === 'accepted') z.approved++;
    }
    const states: Record<string, ZoneState> = {};
    for (const [id, z] of Object.entries(byZone)) {
      if (z.waiting) states[id] = 'waiting';
      else if (z.approved) states[id] = 'approved';
    }
    return { requests, byZone, states, refresh };
  }, [requests, refresh]);
}
