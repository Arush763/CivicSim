/**
 * The worldwide zone grid. Every point on Earth falls in exactly one ~200 m × 200 m zone, so
 * the app and the server agree on zone ids without any import step.
 *
 * Rows are bands of equal latitude height. Columns are ~ZONE_M wide, measured at the middle of
 * the 1° latitude band the row sits in, so column lines run straight within each band (~111 km)
 * instead of shifting row to row. Id: `g{row}_{col}`, e.g. g72975_59640.
 */

export const ZONE_M = 200;
const M_PER_DEG = 111_195;
const D_LAT = ZONE_M / M_PER_DEG;
const MAX_ROW = Math.floor(180 / D_LAT);
const ID_RE = /^g(\d+)_(\d+)$/;

type Bbox = [number, number, number, number];

const rowLat = (row: number) => -90 + (row + 0.5) * D_LAT;
/** Column width in degrees of longitude for a row; rows near the poles are capped to stay sane. */
const colWidth = (row: number) => {
  const bandMid = Math.min(89.5, Math.floor(rowLat(row)) + 0.5);
  return ZONE_M / (M_PER_DEG * Math.max(0.05, Math.cos((bandMid * Math.PI) / 180)));
};
const colCount = (row: number) => Math.ceil(360 / colWidth(row));

export const isZoneId = (id: string) => ID_RE.test(id);

export function zoneIdAt(lng: number, lat: number): string {
  const row = Math.min(MAX_ROW, Math.max(0, Math.floor((lat + 90) / D_LAT)));
  const wrapped = ((((lng + 180) % 360) + 360) % 360);
  const col = Math.min(colCount(row) - 1, Math.floor(wrapped / colWidth(row)));
  return `g${row}_${col}`;
}

function parse(id: string): [number, number] | null {
  const m = ID_RE.exec(id);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** [west, south, east, north] of a zone, or null for an id that isn't on the grid. */
export function zoneBbox(id: string): Bbox | null {
  const rc = parse(id);
  if (!rc) return null;
  const [row, col] = rc;
  const w = colWidth(row);
  const south = -90 + row * D_LAT;
  const west = -180 + col * w;
  return [west, south, Math.min(180, west + w), south + D_LAT];
}

/** The zone and the up-to-8 zones around it (rows have different column widths, so match by position). */
export function zoneBlock(id: string): string[] {
  const b = zoneBbox(id);
  if (!b) return [];
  const [w, s, e, n] = b;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const out = new Set<string>();
  for (const dy of [-1, 0, 1]) {
    for (const dx of [-1, 0, 1]) out.add(zoneIdAt(cx + dx * (e - w), cy + dy * (n - s)));
  }
  return [...out];
}

/** Every zone overlapping a view (for drawing the grid). Returns [] when the view is too large. */
export function zonesInView([w, s, e, n]: Bbox, max = 600): string[] {
  const out: string[] = [];
  const r0 = Math.max(0, Math.floor((s + 90) / D_LAT));
  const r1 = Math.min(MAX_ROW, Math.floor((n + 90) / D_LAT));
  if ((r1 - r0 + 1) * Math.ceil((e - w) / colWidth(r0)) > max * 1.5) return [];
  for (let r = r0; r <= r1; r++) {
    const cw = colWidth(r);
    const c0 = Math.floor((w + 180) / cw);
    const c1 = Math.floor((e + 180) / cw);
    for (let c = c0; c <= c1; c++) {
      out.push(`g${r}_${c}`);
      if (out.length > max) return [];
    }
  }
  return out;
}
