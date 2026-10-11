import { CHANGE_OP_LABELS, RANK_TIERS, zoneBbox, type AreaDetail, type ChangeOp } from '@mamdani/shared';
import type { Theme } from './theme';

/** "$156k", "$2.7M" */
export const money = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;
export const costRange = (c: { low: number; high: number } | null | undefined) => (c && c.high > 0 ? `${money(c.low)} – ${money(c.high)}` : '$0');

/** "2 days ago" (long) or "2d" (short). */
export function ago(iso: string, short = false) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  const [n, unit] = s < 60 ? [0, 'now'] : s < 3600 ? [Math.floor(s / 60), 'm'] : s < 86400 ? [Math.floor(s / 3600), 'h'] : s < 604800 ? [Math.floor(s / 86400), 'd'] : s < 31536000 ? [Math.floor(s / 604800), 'w'] : [Math.floor(s / 31536000), 'y'];
  if (unit === 'now') return 'now';
  if (short) return `${n}${unit}`;
  const word = { m: 'minute', h: 'hour', d: 'day', w: 'week', y: 'year' }[unit as 'm']!;
  return `${n} ${word}${n === 1 ? '' : 's'} ago`;
}

export const initials = (name: string | null | undefined) =>
  (name ?? '?').replace(/[^a-zA-Z0-9 ._-]/g, '').split(/[ ._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?';

/** A zone by its centre: "40.7262°N 73.9971°W". */
export const zoneCoords = (id: string) => {
  const b = zoneBbox(id);
  if (!b) return id.toUpperCase();
  const lat = (b[1] + b[3]) / 2;
  const lng = (b[0] + b[2]) / 2;
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
};

export type Status = 'submitted' | 'under_review' | 'accepted' | 'rejected';
export const STATUS_SHORT: Record<Status, string> = { submitted: 'Waiting', under_review: 'Under review', accepted: 'Approved', rejected: 'Not approved' };
export const STATUS_LONG: Record<Status, string> = {
  submitted: 'Waiting for city review',
  under_review: 'Under city review',
  accepted: 'Approved by the city',
  rejected: 'Not approved',
};
export const statusColors = (s: Status, c: Theme) =>
  s === 'accepted' ? { bg: c.okBg, fg: c.okFg, dot: c.okDot } : s === 'rejected' ? { bg: c.badBg, fg: c.badFg, dot: c.danger } : { bg: c.waitBg, fg: c.waitFg, dot: c.waitDot };

/** The next rank up and how far along you are. */
export function rankProgress(points: number) {
  const idx = RANK_TIERS.reduce((i, t, k) => (points >= t.min ? k : i), 0);
  const cur = RANK_TIERS[idx];
  const next = RANK_TIERS[idx + 1] ?? null;
  const frac = next ? (points - cur.min) / (next.min - cur.min) : 1;
  return { idx, cur, next, frac: Math.max(0, Math.min(1, frac)), toGo: next ? next.min - points : 0 };
}

/** Distinct change types in a request, in words ("Bike lane", "Plant trees"). */
export const opKinds = (ops: ChangeOp[]) => [...new Set(ops.map((o) => CHANGE_OP_LABELS[o.type]))];

/** Numbers for a zone's "About" card. */
export function zoneStats(a: AreaDetail) {
  const streets = new Set(a.scene.streets.map((s) => s.name).filter(Boolean)).size;
  const hs = a.scene.buildings.map((b) => b.heightM);
  const avg = hs.length ? Math.round(hs.reduce((x, y) => x + y, 0) / hs.length) : 0;
  return { buildings: a.scene.buildings.length, streets, avgHeight: avg, tallest: hs.length ? Math.round(Math.max(...hs)) : 0 };
}

/** A plain-language description of a zone from its streets and buildings. */
export function describeZone(a: AreaDetail): string {
  const byLength = new Map<string, number>();
  for (const s of a.scene.streets) if (s.name) byLength.set(s.name, (byLength.get(s.name) ?? 0) + s.lengthM);
  const streets = [...byLength.entries()].sort((x, y) => y[1] - x[1]).map(([n]) => n).slice(0, 3);
  const { buildings, tallest } = zoneStats(a);
  const hs = a.scene.buildings.map((b) => b.heightM).sort((x, y) => x - y);
  const median = hs.length ? hs[Math.floor(hs.length / 2)] : 0;
  const storeys = Math.max(1, Math.round((median - 1) / 3.2));
  const where = streets.length === 0 ? 'No mapped streets run through this zone.' : streets.length === 1 ? `${streets[0]} runs through this zone.` : `${listJoin(streets)} meet here.`;
  const what = !buildings
    ? 'There are no buildings mapped here.'
    : `Mostly ${median < 15 ? 'low-rise' : median < 30 ? 'mid-rise' : 'tall'} buildings of about ${storeys} storey${storeys === 1 ? '' : 's'}; the tallest is ${tallest} m.`;
  return `${where} ${what}`;
}

function listJoin(xs: string[]) {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

export const ISSUE_LABELS: Record<string, string> = {
  street_condition: 'Street condition',
  noise: 'Noise',
  heat_hot_water: 'Heat / hot water',
  sanitation: 'Sanitation',
  traffic_safety: 'Traffic safety',
  parking: 'Parking',
  trees_parks: 'Trees & parks',
  housing_condition: 'Housing',
  homelessness: 'Homelessness',
  other: 'Other',
};
