/** Small, dependency-free geo helpers shared by the app and server. */

const R = 6371008.8; // mean earth radius, meters
const toRad = (d: number) => (d * Math.PI) / 180;

/** Local equirectangular projection around an origin; accurate to <0.1% over a few km. */
export function project(origin: [number, number], p: [number, number]): [number, number] {
  const [lng0, lat0] = origin;
  const x = toRad(p[0] - lng0) * R * Math.cos(toRad(lat0));
  const y = toRad(p[1] - lat0) * R;
  return [x, y];
}

export function unproject(origin: [number, number], xy: [number, number]): [number, number] {
  const [lng0, lat0] = origin;
  const lng = lng0 + (xy[0] / (R * Math.cos(toRad(lat0)))) * (180 / Math.PI);
  const lat = lat0 + (xy[1] / R) * (180 / Math.PI);
  return [lng, lat];
}

export function lineLengthM(line: [number, number][]): number {
  if (line.length < 2) return 0;
  const o = line[0];
  let len = 0;
  for (let i = 1; i < line.length; i++) {
    const a = project(o, line[i - 1]);
    const b = project(o, line[i]);
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

export function polygonAreaM2(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  const o = ring[0];
  const pts = ring.map((p) => project(o, p));
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function centroid(ring: [number, number][]): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

export function bboxContains(b: [number, number, number, number], p: [number, number]): boolean {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

export const M2_PER_FT2 = 0.09290304;
export const M_PER_MILE = 1609.344;
