/**
 * The heat map, for every zone in view anywhere in the world (shared/src/heat.ts has the colours):
 *
 * - Cities that publish their 311 complaints (New York, Chicago, San Francisco): the real number
 *   of complaints in each zone over the last 90 days.
 * - Everywhere else: a "need" score from OpenStreetMap, 0–100: main roads without bike lanes,
 *   wide or fast roads, roads mapped without sidewalks, few street trees, and no park nearby.
 *
 * Both are worked out per "chunk" (a 0.02° square, about 2 km across) with one request each, and
 * kept on disk, so a view is slow only the first time anyone looks at it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { heatLevel, zoneBbox, zoneIdAt, type HeatLevel } from '@mamdani/shared';
import { config } from '../config';
import { overpass, type OsmElement } from './osm';

type Bbox = [number, number, number, number];

export interface ZoneHeat {
  id: string;
  level: HeatLevel;
  source: 'complaints' | 'need';
  /** Complaints in 90 days, or the need score (0–100). */
  value: number;
}

const LOOKBACK_DAYS = 90;
const CHUNK = 0.02;
const COMPLAINTS_TTL_MS = 24 * 3600_000;
const NEED_TTL_MS = 14 * 24 * 3600_000;
/** Views bigger than this many chunks get no heat (zoom in): keeps a view to a handful of requests. */
const MAX_CHUNKS = 16;

interface City311 {
  name: string;
  box: Bbox;
  url: string;
  date: string;
  lat: string;
  lng: string;
}

/** 311 datasets checked to answer grouped counts (Socrata). */
const CITIES: City311[] = [
  { name: 'nyc', box: [-74.26, 40.49, -73.69, 40.92], url: 'https://data.cityofnewyork.us/resource/erm2-nwe9.json', date: 'created_date', lat: 'latitude', lng: 'longitude' },
  { name: 'chicago', box: [-87.95, 41.64, -87.52, 42.03], url: 'https://data.cityofchicago.org/resource/v6vf-nfxy.json', date: 'created_date', lat: 'latitude', lng: 'longitude' },
  { name: 'sf', box: [-122.52, 37.70, -122.35, 37.84], url: 'https://data.sf.gov/resource/vw6y-z8j6.json', date: 'requested_datetime', lat: 'lat', lng: 'long' },
];

const inBox = ([lng, lat]: [number, number], [w, s, e, n]: Bbox) => lng >= w && lng <= e && lat >= s && lat <= n;

// ------------------------------------------------------------------ caching

const heatDir = () => path.join(config.cacheDir, 'heat');
const memory = new Map<string, { at: number; zones: Record<string, number> }>();
const inflight = new Map<string, Promise<Record<string, number>>>();

async function cached(key: string, ttl: number, make: () => Promise<Record<string, number>>): Promise<Record<string, number>> {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.zones;
  const file = path.join(heatDir(), `${key}.json`);
  if (!hit && existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { at: number; zones: Record<string, number> };
    memory.set(key, saved);
    if (Date.now() - saved.at < ttl) return saved.zones;
  }
  let job = inflight.get(key);
  if (!job) {
    job = make()
      .then((zones) => {
        const entry = { at: Date.now(), zones };
        memory.set(key, entry);
        mkdirSync(heatDir(), { recursive: true });
        writeFileSync(file, JSON.stringify(entry));
        return zones;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return job;
}

// ------------------------------------------------------------------ complaints (311)

async function complaintsInChunk(city: City311, [w, s, e, n]: Bbox): Promise<Record<string, number>> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 19);
  // Counted on a ~100 m grid in one request, then added up per zone.
  const K = 1000;
  const qs = new URLSearchParams({
    $select: `floor(${city.lat}*${K}) as la, floor(${city.lng}*${K}) as lo, count(*) as n`,
    $where: `${city.date} > '${since}' AND ${city.lat} between ${s} and ${n} AND ${city.lng} between ${w} and ${e}`,
    $group: 'la, lo',
    $limit: '50000',
  });
  const headers: Record<string, string> = { accept: 'application/json' };
  if (process.env.NYC_APP_TOKEN && city.name === 'nyc') headers['x-app-token'] = process.env.NYC_APP_TOKEN;
  const res = await fetch(`${city.url}?${qs}`, { headers, signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`${city.name} 311: ${res.status}`);
  const rows = (await res.json()) as { la?: string; lo?: string; n: string }[];
  const zones: Record<string, number> = {};
  for (const r of rows) {
    if (r.la == null || r.lo == null) continue;
    const id = zoneIdAt((Number(r.lo) + 0.5) / K, (Number(r.la) + 0.5) / K);
    zones[id] = (zones[id] ?? 0) + Number(r.n);
  }
  return zones;
}

// ------------------------------------------------------------------ need score (OpenStreetMap)

const R = 6_371_000;
const metres = (a: [number, number], b: [number, number]) => {
  const x = ((b[0] - a[0]) * Math.PI) / 180 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const y = ((b[1] - a[1]) * Math.PI) / 180;
  return Math.hypot(x, y) * R;
};
const MAIN = /^(trunk|primary|secondary|tertiary)$/;
const hasCycleway = (t: Record<string, string>) =>
  ['cycleway', 'cycleway:both', 'cycleway:left', 'cycleway:right'].some((k) => t[k] && !/^(no|none|shared_lane)$/.test(t[k])) || t.bicycle === 'designated';
const kmh = (v: string | undefined) => {
  const m = v?.match(/^(\d+)\s*(mph)?/);
  return m ? Number(m[1]) * (m[2] ? 1.609 : 1) : null;
};

/** The need score (0–100) of each zone in a chunk, from its streets, trees and parks. */
export function needScores(elements: (OsmElement & { center?: { lat: number; lon: number } })[]): Record<string, number> {
  const z = new Map<string, { len: number; main: number; mainNoBike: number; fast: number; noSidewalk: number; trees: number; park: boolean }>();
  const zone = (id: string) => {
    let v = z.get(id);
    if (!v) z.set(id, (v = { len: 0, main: 0, mainNoBike: 0, fast: 0, noSidewalk: 0, trees: 0, park: false }));
    return v;
  };
  const parks: [number, number][] = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    if (el.type === 'node' && !t.highway) {
      zone(zoneIdAt(el.lon, el.lat)).trees++;
      continue;
    }
    if (t.leisure === 'park') {
      const c = el.center ?? (el.type === 'node' ? { lat: el.lat, lon: el.lon } : null);
      if (c) parks.push([c.lon, c.lat]);
      continue;
    }
    if (el.type !== 'way' || !el.geometry || !t.highway) continue;
    const main = MAIN.test(t.highway);
    const fast = /^(trunk|primary)$/.test(t.highway) || Number(t.lanes) >= 4 || (kmh(t.maxspeed) ?? 0) >= 50;
    const noSidewalk = /^(no|none)$/.test(t.sidewalk ?? '');
    for (let i = 0; i < el.geometry.length - 1; i++) {
      const a: [number, number] = [el.geometry[i].lon, el.geometry[i].lat];
      const b: [number, number] = [el.geometry[i + 1].lon, el.geometry[i + 1].lat];
      const len = metres(a, b);
      const v = zone(zoneIdAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2));
      v.len += len;
      if (main) {
        v.main += len;
        if (!hasCycleway(t)) v.mainNoBike += len;
      }
      if (fast) v.fast += len;
      if (noSidewalk) v.noSidewalk += len;
    }
  }
  const scores: Record<string, number> = {};
  for (const [id, v] of z) {
    if (v.len < 40) continue; // no real streets here (water, fields): no colour
    // A park within ~300 m of the zone's centre counts as nearby.
    const mid = idCentre(id);
    v.park = parks.some((p) => metres(p, mid) < 300);
    const treesPerKm = v.trees / (v.len / 1000);
    const score =
      30 * (v.main ? v.mainNoBike / v.main : 0) * Math.min(1, v.main / v.len + 0.3) +
      25 * (v.fast / v.len) +
      15 * (v.noSidewalk / v.len) +
      20 * Math.max(0, 1 - treesPerKm / 30) +
      10 * (v.park ? 0 : 1);
    scores[id] = Math.round(score);
  }
  return scores;
}

/** A zone's centre [lng, lat]. */
const idCentre = (id: string): [number, number] => {
  const b = zoneBbox(id);
  return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [0, 0];
};

async function needInChunk([w, s, e, n]: Bbox): Promise<Record<string, number>> {
  const b = `${s},${w},${n},${e}`;
  const elements = await overpass(`[out:json][timeout:45];
(way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street)$"](${b}););
out tags geom;
node["natural"="tree"](${b});
out skel;
(way["leisure"="park"](${b});relation["leisure"="park"](${b}););
out tags center;`);
  return needScores(elements as (OsmElement & { center?: { lat: number; lon: number } })[]);
}

/** Need score → heat level: about 40% green, 35% yellow, 25% red (measured in New Jersey and London). */
export const needLevel = (score: number): HeatLevel => (score < 31 ? 'low' : score < 49 ? 'medium' : 'high');

// ------------------------------------------------------------------ a view

/** Heat for every zone in a view (empty when the view is too big; zoom in). */
export async function heatInView([w, s, e, n]: Bbox): Promise<ZoneHeat[]> {
  const c0 = Math.floor(w / CHUNK), c1 = Math.floor(e / CHUNK);
  const r0 = Math.floor(s / CHUNK), r1 = Math.floor(n / CHUNK);
  if ((c1 - c0 + 1) * (r1 - r0 + 1) > MAX_CHUNKS) return [];
  const out = new Map<string, ZoneHeat>();
  const jobs: Promise<void>[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const box: Bbox = [c * CHUNK, r * CHUNK, (c + 1) * CHUNK, (r + 1) * CHUNK];
      const centre: [number, number] = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
      const city = CITIES.find((x) => inBox(centre, x.box));
      const key = `${city ? city.name : 'need'}_${r}_${c}`;
      jobs.push(
        cached(key, city ? COMPLAINTS_TTL_MS : NEED_TTL_MS, () => (city ? complaintsInChunk(city, box) : needInChunk(box)))
          .then((zones) => {
            for (const [id, value] of Object.entries(zones)) {
              const level = city ? heatLevel(value) : needLevel(value);
              if (level !== 'none') out.set(id, { id, level, source: city ? 'complaints' : 'need', value });
            }
          })
          .catch(() => {}), // a busy data source leaves that part of the view uncoloured for now
      );
    }
  }
  await Promise.all(jobs);
  return [...out.values()];
}
