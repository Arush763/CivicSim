/**
 * Zone data for anywhere in the world, from OpenStreetMap (via the Overpass API). Opening a
 * zone fetches it and its 8 neighbours in one query and caches each as data/zones/{id}.json in
 * the same shape as the New York pilot tiles, so the scene builder, picker and costs work as-is.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { centroid, lineLengthM, zoneBbox, zoneBlock, type Area } from '@mamdani/shared';
import { config } from '../config';
import { clipRingToBbox } from './clip';
import type { StreetSetting, TileData, TileStreet } from './tiles';

type Bbox = [number, number, number, number];
type LL = [number, number];

interface OsmWay {
  type: 'way';
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}
interface OsmRelation {
  type: 'relation';
  id: number;
  tags?: Record<string, string>;
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
}
interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}
export type OsmElement = OsmWay | OsmRelation | OsmNode;

/** How far from its centre point each kind of place counts as built-up, in metres. */
const PLACE_RADIUS: Record<string, number> = { city: 6000, town: 2500, suburb: 1500, village: 1000, quarter: 800, neighbourhood: 600 };

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const ROADS = 'trunk|primary|secondary|tertiary|unclassified|residential|living_street';

export const zonesDir = () => path.join(config.dataDir, 'zones');
const zoneFile = (id: string) => path.join(zonesDir(), `${id}.json`);

// ------------------------------------------------------------------ fetching

export async function overpass(query: string): Promise<OsmElement[]> {
  // The public Overpass servers are often busy or down: ask them all at once and take the first
  // good answer (the others are cancelled), a few rounds with back-off if none answers.
  let last: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const stop = new AbortController();
    try {
      return await Promise.any(
        ENDPOINTS.map(async (url) => {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'CivicSim/1.0 (city change proposals)' },
            body: new URLSearchParams({ data: query }),
            signal: AbortSignal.any([stop.signal, AbortSignal.timeout(45_000)]),
          });
          const text = await res.text();
          if (res.ok && text.startsWith('{')) return (JSON.parse(text) as { elements: OsmElement[] }).elements;
          throw new Error(`Overpass ${res.status}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}`);
        }),
      );
    } catch (err) {
      last = (err as AggregateError).errors?.[0] ?? (err as Error);
    } finally {
      stop.abort();
    }
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
  }
  throw last ?? new Error('Overpass failed');
}

export function blockQuery([w, s, e, n]: Bbox): string {
  const b = `${s},${w},${n},${e}`;
  const c = `${(s + n) / 2},${(w + e) / 2}`;
  return `[out:json][timeout:60];
(
  way["building"](${b});
  relation["building"]["type"="multipolygon"](${b});
  way["highway"~"^(${ROADS})$"](${b});
  way["leisure"~"^(park|garden|playground)$"](${b});
  way["landuse"~"^(residential|commercial|retail|industrial)$"](${b});
  node["place"~"^(city|town|suburb|village|quarter|neighbourhood)$"](around:6000,${c});
  relation["leisure"~"^(park|garden)$"]["type"="multipolygon"](${b});
);
out tags geom;`;
}

// ------------------------------------------------------------------ parsing

const toLL = (g: { lat: number; lon: number }[]): LL[] => g.map((p) => [p.lon, p.lat]);
const closed = (r: LL[]) => r.length >= 4 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];
const openRing = (r: LL[]) => (closed(r) ? r.slice(0, -1) : r);

/** "23.5", "23.5 m", "75'" → meters. */
export function parseMeters(v: string | undefined): number | null {
  if (!v) return null;
  const feet = /^\s*([\d.]+)\s*(ft|')\s*$/.exec(v);
  if (feet) return Number(feet[1]) * 0.3048;
  const m = /^\s*([\d.]+)\s*m?\s*$/.exec(v);
  return m ? Number(m[1]) : null;
}

export function buildingHeight(tags: Record<string, string>): number {
  const h = parseMeters(tags.height);
  if (h && h > 2) return h;
  const levels = Number(tags['building:levels']);
  if (levels > 0) return levels * 3.2 + 1;
  if (/^(house|detached|bungalow|garage|garages|shed|hut|cabin|kiosk|roof)$/.test(tags.building)) return 6;
  return 10;
}

const isBikeLane = (v: string | undefined) => !!v && /^(lane|track|opposite_lane|opposite_track|separate)$/.test(v);

export function streetProfile(tags: Record<string, string>): Omit<TileStreet, 'id' | 'line'> {
  const cls = tags.highway;
  const oneway = tags.oneway === 'yes' || tags.oneway === '1';
  const defaultLanes = { trunk: 4, primary: 3, secondary: 2, tertiary: 2 }[cls] ?? (oneway ? 1 : 2);
  const travelLanes = Math.max(1, Number(tags.lanes) || defaultLanes);
  const parkingTag = tags['parking:both'] ?? tags['parking:lane:both'];
  const sideParked = (side: 'left' | 'right') => {
    const v = tags[`parking:${side}`] ?? tags[`parking:lane:${side}`] ?? parkingTag;
    return v === undefined ? null : !/^(no|no_parking|no_stopping|separate)$/.test(v);
  };
  const tagged = [sideParked('left'), sideParked('right')];
  const parkingLanes = tagged.some((v) => v !== null)
    ? tagged.filter(Boolean).length
    : /^(trunk|living_street)$/.test(cls) ? 0 : 2; // most city streets have curbside parking
  const width = parseMeters(tags.width);
  const hasBikeLane = ['cycleway', 'cycleway:both', 'cycleway:left', 'cycleway:right'].some((k) => isBikeLane(tags[k]));
  return {
    name: tags.name ?? tags.ref ?? 'Unnamed street',
    oneway,
    widthM: Math.max(6, width ?? travelLanes * 3.3 + parkingLanes * 2.4 + (hasBikeLane ? 1.8 : 0)),
    travelLanes,
    parkingLanes,
    hasBikeLane,
  };
}

/**
 * Urban, suburban or rural, from how built-up the street is: buildings within 35 m per 100 m of
 * street, mapped sidewalks, road class and speed limit.
 */
export function streetSetting(
  tags: Record<string, string>,
  line: LL[],
  buildings: LL[][],
  townAreas: LL[][] = [],
  towns: { at: LL; radius: number }[] = [],
): StreetSetting {
  const k = Math.cos((line[0][1] * Math.PI) / 180) * 111_195;
  const m = (p: LL): LL => [p[0] * k, p[1] * 111_195];
  const pts = line.map(m);
  const length = pts.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  if (length < 5) return 'urban';
  const distToLine = (q: LL) => {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy)));
    }
    return best;
  };
  let near = 0;
  for (const ring of buildings) if (distToLine(m(centroid(ring))) < 35) near++;
  const perHundred = (near / Math.max(length, 50)) * 100;
  const sidewalk = /^(both|left|right|yes|separate)$/.test(tags.sidewalk ?? tags['sidewalk:both'] ?? '');
  const speed = parseInt(tags.maxspeed ?? '', 10) * (/mph/.test(tags.maxspeed ?? '') ? 1.609 : 1);
  if (perHundred >= 8) return 'urban';
  // Residential roads are in settlements even where OSM is missing the houses themselves.
  if (/^(residential|living_street)$/.test(tags.highway)) return 'suburban';
  const mid = line[Math.floor(line.length / 2)];
  const inTown = townAreas.some((ring) => pointInLL(mid, ring)) || towns.some((t) => Math.hypot((t.at[0] - mid[0]) * k, (t.at[1] - mid[1]) * 111_195) < t.radius);
  if (perHundred >= 2.5 || sidewalk || inTown) return speed >= 70 ? 'rural' : 'suburban';
  return 'rural';
}

function pointInLL([x, y]: LL, ring: LL[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * One half of a divided road: a one-way whose same-named twin runs alongside it (within 30 m)
 * in the opposite direction. (Pieces of an ordinary street continue in the same direction.)
 */
function hasOppositeTwin(way: OsmWay, roads: OsmWay[]): boolean {
  const line = toLL(way.geometry!);
  const k = Math.cos((line[0][1] * Math.PI) / 180) * 111_195;
  const m = (p: LL): LL => [p[0] * k, p[1] * 111_195];
  const i = Math.max(0, Math.floor(line.length / 2) - 1);
  const [a, b] = [m(line[i]), m(line[i + 1])];
  const mid: LL = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dir = norm([b[0] - a[0], b[1] - a[1]]);
  return roads.some((o) => {
    if (o.id === way.id || o.tags?.name !== way.tags?.name || o.tags?.oneway !== 'yes') return false;
    const pts = toLL(o.geometry!).map(m);
    for (let j = 0; j < pts.length - 1; j++) {
      const [c, d] = [pts[j], pts[j + 1]];
      const near = Math.hypot((c[0] + d[0]) / 2 - mid[0], (c[1] + d[1]) / 2 - mid[1]) < 30;
      const od = norm([d[0] - c[0], d[1] - c[1]]);
      if (near && od[0] * dir[0] + od[1] * dir[1] < -0.5) return true;
    }
    return false;
  });
}
const norm = (v: LL): LL => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

const hasParkingTags = (tags: Record<string, string>) => Object.keys(tags).some((k) => k.startsWith('parking'));

/** Closed outer rings of a way or multipolygon relation. */
function rings(el: OsmElement): LL[][] {
  if (el.type === 'node') return [];
  if (el.type === 'way') {
    const r = el.geometry ? toLL(el.geometry) : [];
    return closed(r) ? [openRing(r)] : [];
  }
  return (el.members ?? [])
    .filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry)
    .map((m) => toLL(m.geometry!))
    .filter(closed)
    .map(openRing);
}

/** The parts of a polyline inside a bbox (segment-wise Liang–Barsky, joined into runs). */
export function clipLine(line: LL[], [w, s, e, n]: Bbox): LL[][] {
  const runs: LL[][] = [];
  let cur: LL[] = [];
  const flush = () => {
    if (cur.length >= 2) runs.push(cur);
    cur = [];
  };
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, y0] = line[i];
    const [x1, y1] = line[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    for (const [p, q] of [[-dx, x0 - w], [dx, e - x0], [-dy, y0 - s], [dy, n - y0]] as const) {
      if (p === 0) {
        if (q < 0) ok = false;
      } else {
        const r = q / p;
        if (p < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
      }
    }
    if (!ok || t0 > t1) {
      flush();
      continue;
    }
    const a: LL = [x0 + t0 * dx, y0 + t0 * dy];
    const b: LL = [x0 + t1 * dx, y0 + t1 * dy];
    const last = cur[cur.length - 1];
    if (!last || last[0] !== a[0] || last[1] !== a[1]) {
      flush();
      cur.push(a);
    }
    cur.push(b);
    if (t1 < 1) flush();
  }
  flush();
  return runs;
}

/**
 * How wide a street really is, from the gap between the buildings on either side: sample a few
 * points along it, look sideways for the nearest building wall each way, and take the median
 * gap. Returns the roadway width (gap minus two sidewalks), or null if there aren't buildings
 * on both sides.
 */
export function roadwayFromBuildings(line: LL[], buildings: LL[][]): number | null {
  if (line.length < 2) return null;
  const k = Math.cos((line[0][1] * Math.PI) / 180) * 111_195;
  const m = (p: LL): LL => [p[0] * k, p[1] * 111_195];
  const pts = line.map(m);
  const lengths = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total < 20) return null;
  const near = buildings.map((r) => r.map(m)).filter((r) => r.some(([x, y]) => Math.hypot(x - pts[0][0], y - pts[0][1]) < total + 60));
  const gaps: number[] = [];
  for (const f of [0.25, 0.5, 0.75]) {
    let left = f * total;
    let i = 0;
    while (i < lengths.length - 1 && left > lengths[i]) left -= lengths[i++];
    const [a, b] = [pts[i], pts[i + 1]];
    const t = lengths[i] ? left / lengths[i] : 0;
    const p: LL = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const d: LL = [(b[0] - a[0]) / (lengths[i] || 1), (b[1] - a[1]) / (lengths[i] || 1)];
    const side = (sign: number) => {
      const n: LL = [-d[1] * sign, d[0] * sign];
      let best = 40; // look up to 40 m each way
      for (const ring of near) {
        for (let j = 0; j < ring.length; j++) {
          const [c, e] = [ring[j], ring[(j + 1) % ring.length]];
          // Ray p + s·n against segment c→e.
          const ex = e[0] - c[0], ey = e[1] - c[1];
          const den = n[0] * ey - n[1] * ex;
          if (Math.abs(den) < 1e-9) continue;
          const s = ((c[0] - p[0]) * ey - (c[1] - p[1]) * ex) / den;
          const u = ((c[0] - p[0]) * n[1] - (c[1] - p[1]) * n[0]) / den;
          if (s > 0.5 && s < best && u >= 0 && u <= 1) best = s;
        }
      }
      return best < 40 ? best : null;
    };
    const l = side(1);
    const r = side(-1);
    if (l !== null && r !== null) gaps.push(l + r);
  }
  if (!gaps.length) return null;
  const gap = gaps.sort((x, y) => x - y)[Math.floor(gaps.length / 2)];
  const sidewalk = Math.min(6, Math.max(2.5, gap * 0.2));
  const road = gap - 2 * sidewalk;
  return road >= 5 ? Math.min(30, road) : null;
}

/** Split one Overpass result into per-zone tile data. */
export function osmToTiles(elements: OsmElement[], zoneIds: string[]): TileData[] {
  const tiles = zoneIds.map((id): TileData => ({ id, bbox: zoneBbox(id)!, buildings: [], streets: [], parks: [] }));
  // Every building outline in the fetch, for measuring street widths.
  const outlines = elements.filter((el) => el.tags?.building && el.tags.building !== 'no').flatMap(rings);
  // Mapped town areas and town centres: in many places these exist even where buildings don't.
  const townAreas = elements.filter((el) => el.tags?.landuse && el.type !== 'node').flatMap(rings);
  const towns = elements.filter((el): el is OsmNode => el.type === 'node' && !!el.tags?.place).map((el) => ({ at: [el.lon, el.lat] as LL, radius: PLACE_RADIUS[el.tags!.place] ?? 0 }));
  const roads = elements.filter((el): el is OsmWay => el.type === 'way' && !!el.tags?.highway && !!el.geometry);
  const inside = (b: Bbox, p: LL) => p[0] >= b[0] && p[0] < b[2] && p[1] >= b[1] && p[1] < b[3];
  const seenBuilding = new Set<string>();

  for (const el of elements) {
    const tags = el.tags ?? {};
    if (tags.building && tags.building !== 'no') {
      for (const [k, ring] of rings(el).entries()) {
        if (ring.length < 3) continue;
        const id = `${el.type === 'way' ? 'w' : 'r'}${el.id}${k ? `_${k}` : ''}`;
        if (seenBuilding.has(id)) continue;
        const t = tiles.find((t) => inside(t.bbox, centroid(ring)));
        if (!t) continue;
        seenBuilding.add(id);
        t.buildings.push({ id, ring, heightM: buildingHeight(tags) });
      }
    } else if (tags.highway && el.type === 'way' && el.geometry) {
      const line = toLL(el.geometry);
      const profile = streetProfile(tags);
      // Without a mapped width, measure the street between its buildings. Skip one half of a
      // divided road (a one-way with a same-named twin), whose gap includes both halves.
      profile.setting = streetSetting(tags, line, outlines, townAreas, towns);
      if (profile.setting === 'rural' && !hasParkingTags(tags)) {
        // Country roads: no kerbside parking, just the lanes and a narrow shoulder.
        profile.parkingLanes = 0;
        if (!parseMeters(tags.width)) profile.widthM = Math.max(5.5, profile.travelLanes * 3.3 + 0.6);
      }
      const divided = tags.oneway === 'yes' && hasOppositeTwin(el, roads);
      if (divided && !hasParkingTags(tags)) {
        // One half of a divided road: usually no kerbside parking, just its traffic lanes.
        profile.parkingLanes = 0;
        if (!parseMeters(tags.width)) profile.widthM = Math.max(6, profile.travelLanes * 3.3 + 1 + (profile.hasBikeLane ? 1.8 : 0));
      }
      if (!parseMeters(tags.width) && !divided) {
        const measured = roadwayFromBuildings(line, outlines);
        // Trust the measurement only within reason: an open square or car park beside the street isn't road.
        const cap = Math.max(profile.widthM * 1.8, profile.widthM + 6);
        if (measured && measured > profile.widthM) profile.widthM = Math.round(Math.min(measured, cap) * 10) / 10;
      }
      for (const t of tiles) {
        clipLine(line, t.bbox)
          .filter((run) => lineLengthM(run) >= 15)
          .forEach((run, k) => t.streets.push({ id: `w${el.id}${k ? `_${k}` : ''}`, line: run, ...profile }));
      }
    } else if (tags.leisure && !tags.landuse) {
      for (const ring of rings(el)) {
        for (const t of tiles) {
          const clipped = clipRingToBbox(ring, t.bbox);
          if (clipped.length >= 3) t.parks.push({ id: `${el.type[0]}${el.id}`, name: tags.name ?? 'Park', ring: clipped });
        }
      }
    }
  }
  for (const t of tiles) t.streets = mergeStreets(t.streets);
  return tiles;
}

/**
 * OpenStreetMap splits a street into many short ways (at every bus stop, lane change, bridge…).
 * Join pieces of the same street that continue end-to-start, so a person picks "Canal Street"
 * once rather than one of six fragments. Only joins in the drawing direction, since a lane's
 * left/right side depends on it, and never joins unnamed streets.
 */
export function mergeStreets(streets: TileStreet[]): TileStreet[] {
  const same = (a: LL, b: LL) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  // Same named street; the joined piece keeps the first piece's lanes and width.
  const key = (st: TileStreet) => st.name;
  const out = streets.map((st) => ({ ...st, line: [...st.line] }));
  for (let joined = true; joined; ) {
    joined = false;
    for (const a of out) {
      if (a.name === 'Unnamed street') continue;
      const b = out.find((x) => x !== a && key(x) === key(a) && same(a.line[a.line.length - 1], x.line[0]) && straightOn(a.line, x.line));
      if (!b) continue;
      a.line.push(...b.line.slice(1));
      out.splice(out.indexOf(b), 1);
      joined = true;
      break;
    }
  }
  return out;
}

/** True when `next` carries on from the end of `line` without turning more than ~45°. */
function straightOn(line: LL[], next: LL[]): boolean {
  const k = Math.cos((line[0][1] * Math.PI) / 180);
  const dir = (a: LL, b: LL) => {
    const v = [(b[0] - a[0]) * k, b[1] - a[1]];
    const l = Math.hypot(v[0], v[1]) || 1;
    return [v[0] / l, v[1] / l];
  };
  const u = dir(line[line.length - 2], line[line.length - 1]);
  const v = dir(next[0], next[1]);
  return u[0] * v[0] + u[1] * v[1] > Math.SQRT1_2;
}

/** "Canal Street & Broadway": the two streets with the most length in the zone. */
export function nameZone(t: TileData): string {
  const byName = new Map<string, number>();
  for (const s of t.streets) if (s.name !== 'Unnamed street') byName.set(s.name, (byName.get(s.name) ?? 0) + lineLengthM(s.line));
  const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
  if (top.length) return top.join(' & ');
  const park = t.parks.find((p) => p.name !== 'Park');
  if (park) return park.name;
  const [w, s, e, n] = t.bbox;
  return `Zone at ${((s + n) / 2).toFixed(4)}, ${((w + e) / 2).toFixed(4)}`;
}

// ------------------------------------------------------------------ cache

type Stored = TileData & { name: string; fetchedAt: string };
const memory = new Map<string, Stored>();
const inflight = new Map<string, Promise<void>>();

export function cachedZone(id: string): Stored | null {
  const hit = memory.get(id);
  if (hit) return hit;
  if (!existsSync(zoneFile(id))) return null;
  const z = JSON.parse(readFileSync(zoneFile(id), 'utf8')) as Stored;
  memory.set(id, z);
  return z;
}

/** Every zone fetched so far (names and boxes only). */
export function cachedZoneAreas(): Area[] {
  if (!existsSync(zonesDir())) return [];
  return readdirSync(zonesDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => cachedZone(f.slice(0, -5)))
    .filter((z): z is Stored => !!z)
    .map((z) => ({ id: z.id, name: z.name, bbox: z.bbox, issueTotal: 0 }));
}

/** Make sure a zone (and the zones around it) is on disk, fetching from OpenStreetMap if needed. */
export async function ensureZone(id: string, fetchFn: (q: string) => Promise<OsmElement[]> = overpass): Promise<Stored> {
  const hit = cachedZone(id);
  if (hit) return hit;
  let job = inflight.get(id);
  if (!job) {
    const block = zoneBlock(id);
    const boxes = block.map((z) => zoneBbox(z)!);
    const bbox: Bbox = [
      Math.min(...boxes.map((b) => b[0])),
      Math.min(...boxes.map((b) => b[1])),
      Math.max(...boxes.map((b) => b[2])),
      Math.max(...boxes.map((b) => b[3])),
    ];
    job = (async () => {
      const elements = await fetchFn(blockQuery(bbox));
      mkdirSync(zonesDir(), { recursive: true });
      const fetchedAt = new Date().toISOString();
      for (const t of osmToTiles(elements, block)) {
        // Keep zones already on disk as they are, so ids that requests refer to never shift.
        if (existsSync(zoneFile(t.id))) continue;
        const stored: Stored = { ...t, name: nameZone(t), fetchedAt };
        writeFileSync(`${zoneFile(t.id)}.tmp`, JSON.stringify(stored));
        renameSync(`${zoneFile(t.id)}.tmp`, zoneFile(t.id));
      }
    })().finally(() => {
      for (const z of block) inflight.delete(z);
    });
    for (const z of block) if (!inflight.has(z)) inflight.set(z, job);
  }
  await job;
  const z = cachedZone(id);
  if (!z) throw new Error(`zone ${id} could not be loaded`);
  return z;
}
