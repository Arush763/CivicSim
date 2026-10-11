/**
 * Plain-language descriptions of changes, and where to stand in Street View to see one. Shared by
 * the app and the server (which prepares photo-real views as soon as a request comes in), so both
 * describe and frame a request identically.
 */
import type { ChangeOp } from './changeOps';
import type { SceneIndex } from './domain';

const sideText = (s: 'left' | 'right' | 'both') => (s === 'both' ? 'both sides' : 'one side');
const useText = (u: string) => u.replace(/_/g, ' ');

/** One-line, human description of a change for lists. */
export function describeOp(op: ChangeOp, scene?: SceneIndex | null): string {
  const street = (id: string) => scene?.streets.find((s) => s.id === id)?.name ?? 'a street';
  switch (op.type) {
    case 'add_bike_lane':
      return `${op.protected ? 'Protected' : 'Painted'} bike lane on ${street(op.streetSegmentId)} (${sideText(op.side)})`;
    case 'add_bus_lane':
      return `Bus lane on ${street(op.streetSegmentId)} (${sideText(op.side)})`;
    case 'widen_sidewalk':
      return `Widen sidewalks on ${street(op.streetSegmentId)} by ${op.meters} m`;
    case 'remove_parking':
      return `Remove parking on ${street(op.streetSegmentId)} (${sideText(op.side)})`;
    case 'plant_trees':
      return `Plant ${op.count} trees`;
    case 'add_park':
      return op.name ? `New park: ${op.name}` : 'New park';
    case 'add_crosswalk':
      return op.raised ? 'Raised crosswalk' : 'High-visibility crosswalk';
    case 'replace_building':
      return `Rebuild lot as ${useText(op.use)}, ${op.floors} floors${op.units ? `, ${op.units} homes` : ''}`;
  }
}


const D = Math.PI / 180;
/** Compass bearing (degrees clockwise from north) from a to b. */
function bearing([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]) {
  const y = Math.sin((lng2 - lng1) * D) * Math.cos(lat2 * D);
  const x = Math.cos(lat1 * D) * Math.sin(lat2 * D) - Math.sin(lat1 * D) * Math.cos(lat2 * D) * Math.cos((lng2 - lng1) * D);
  return (Math.atan2(y, x) / D + 360) % 360;
}

/** The point halfway along a line, and which way the line runs there. */
function midway(line: [number, number][]): { at: [number, number]; look: number } | null {
  if (line.length < 2) return null;
  const k = Math.cos(line[0][1] * D);
  const seg = line.slice(1).map((p, i) => Math.hypot((p[0] - line[i][0]) * k, p[1] - line[i][1]));
  let left = seg.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i] || i === seg.length - 1) {
      const f = seg[i] ? Math.min(1, left / seg[i]) : 0;
      const [a, b] = [line[i], line[i + 1]];
      return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], look: bearing(a, b) };
    }
    left -= seg[i];
  }
  return null;
}

const middle = (pts: [number, number][]): [number, number] => [
  pts.reduce((s, p) => s + p[0], 0) / pts.length,
  pts.reduce((s, p) => s + p[1], 0) / pts.length,
];

/**
 * Where to stand in Street View to see a request: the first change's location, and for changes
 * that run along a street, the direction to look down it.
 */
export interface ChangeFocus {
  at: [number, number];
  /** Compass direction to face; omitted to face `at` from wherever the photo was taken. */
  look?: number;
  /** Starting tilt (degrees up) and Street View zoom (1 = 90° across). */
  pitch?: number;
  zoom?: number;
}

export function changeFocus(ops: ChangeOp[], scene?: SceneIndex | null): ChangeFocus | null {
  const op = ops[0];
  if (!op) return null;
  if ('streetSegmentId' in op) {
    const line = scene?.streets.find((s) => s.id === op.streetSegmentId)?.line;
    return line ? midway(line) : null;
  }
  switch (op.type) {
    case 'replace_building': {
      const b = scene?.buildings.find((x) => x.id === op.buildingId);
      // Tilt up and widen the view: a new building is taller than one photo frame up close.
      return b ? { at: b.centroid, pitch: 22, zoom: 0.5 } : null;
    }
    case 'add_park':
      return { at: middle(op.polygon), pitch: -8, zoom: 0.7 };
    case 'plant_trees':
      return op.line ? midway(op.line) : op.polygon ? { at: middle(op.polygon) } : null;
    case 'add_crosswalk':
      return { at: op.at };
  }
  return null;
}

/** A request's description as the photo-real editor gets it: every change, in words. */
export const describeRequest = (ops: ChangeOp[], scene?: SceneIndex | null) => ops.map((o) => describeOp(o, scene)).join('; ');

/**
 * The query for the server's Street View page (/streetview) for one request. The app (to show it)
 * and the server (to prepare photo-real views ahead of time) build it the same way, so both ask
 * for exactly the same edits and share the saved results.
 */
export function streetViewQuery(glbUrl: string, focus: ChangeFocus, ops: ChangeOp[], desc: string): URLSearchParams {
  const q = new URLSearchParams({
    glb: glbUrl,
    at: focus.at.map((v) => v.toFixed(7)).join(','),
    ops: [...new Set(ops.map((o) => o.type))].join(','),
    mode: 'after',
    desc: desc.slice(0, 500),
  });
  for (const k of ['look', 'pitch', 'zoom'] as const) if (focus[k] !== undefined) q.set(k, focus[k]!.toFixed(1));
  return q;
}
