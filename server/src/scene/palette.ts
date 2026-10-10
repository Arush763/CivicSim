import type { BuildingUse } from '@mamdani/shared';
import type { RGB } from './geometry';

/** glTF colors are linear; author in sRGB hex and convert. */
export function hex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}

export type MaterialName =
  | 'ground'
  | 'sidewalk'
  | 'road'
  | 'marking'
  | 'lane_line'
  | 'post'
  | 'bike'
  | 'bus'
  | 'buffer'
  | 'park'
  | 'park_new'
  | 'canopy'
  | 'trunk'
  | 'building'
  | 'building_new'
  | 'car'
  | 'highlight'
  | 'context_road'
  | 'footprint'
  | 'city_building'
  | 'land'
  | 'land_far'
  | 'coast'
  | 'zone_line';

export interface MaterialDef {
  color: RGB;
  vertexColors?: boolean;
  roughness?: number;
  metallic?: number;
  emissive?: RGB;
  alpha?: number;
  /** Lowest-detail LOD index this material still appears in (0 = only the highest detail). */
  maxLod: number;
}

export const MATERIALS: Record<MaterialName, MaterialDef> = {
  // Base: a light, real-map look — pale ground, grey asphalt, light grey buildings.
  ground: { color: hex('#F1F3F4'), roughness: 1, maxLod: 2 },
  sidewalk: { color: hex('#E8EAED'), roughness: 1, maxLod: 1 },
  road: { color: hex('#BDC1C6'), roughness: 1, maxLod: 2 },
  marking: { color: hex('#FFFFFF'), roughness: 0.8, maxLod: 0 },
  park: { color: hex('#CEEAD6'), roughness: 1, maxLod: 2 },
  building: { color: [1, 1, 1], vertexColors: true, roughness: 0.85, maxLod: 2 },
  city_building: { color: hex('#DADCE0'), roughness: 1, maxLod: 2 },
  car: { color: [1, 1, 1], vertexColors: true, roughness: 0.4, metallic: 0.3, maxLod: 0 },
  // Changes, in the colours they'd really be: green bike lanes, red bus lanes, new buildings in blue.
  bike: { color: hex('#34A853'), emissive: hex('#0D3B1C'), roughness: 0.7, maxLod: 2 },
  bus: { color: hex('#D93025'), emissive: hex('#3B0D0A'), roughness: 0.7, maxLod: 2 },
  buffer: { color: hex('#FFFFFF'), roughness: 0.6, maxLod: 1 },
  lane_line: { color: hex('#FFFFFF'), roughness: 0.6, maxLod: 1 },
  post: { color: hex('#FFFFFF'), roughness: 0.5, maxLod: 0 },
  park_new: { color: hex('#81C995'), emissive: hex('#0D3B1C'), roughness: 1, maxLod: 2 },
  canopy: { color: hex('#34A853'), roughness: 0.9, maxLod: 1 },
  trunk: { color: hex('#8D6E63'), roughness: 1, maxLod: 0 },
  building_new: { color: hex('#1A73E8'), emissive: hex('#0B2E6B'), roughness: 0.6, maxLod: 2 },
  highlight: { color: hex('#1A73E8'), emissive: hex('#1A73E8'), alpha: 0.45, roughness: 1, maxLod: 2 },
  context_road: { color: hex('#E8EAED'), roughness: 1, maxLod: 2 },
  footprint: { color: hex('#E8EAED'), roughness: 1, maxLod: 2 },
  // City map (no longer shown in the app; kept for the /city endpoint).
  land: { color: hex('#F1F3F4'), roughness: 1, maxLod: 2 },
  land_far: { color: hex('#E8EAED'), roughness: 1, maxLod: 2 },
  coast: { color: hex('#AADAFF'), alpha: 0.8, roughness: 1, maxLod: 2 },
  zone_line: { color: hex('#5F6368'), alpha: 0.3, roughness: 1, maxLod: 2 },
};

const BUILDING_TONES = ['#b9a58f', '#a8927c', '#c9b8a3', '#9c7b64', '#b58d6e', '#d1c7b7', '#8f7f73', '#bfae9a'].map(hex);
const TOWER_TONES = ['#8a99a6', '#9fb0bd', '#7d8b96', '#aab6bf'].map(hex);

export function buildingColor(seed: number, heightM: number): RGB {
  const tones = heightM > 60 ? TOWER_TONES : BUILDING_TONES;
  return tones[seed % tones.length];
}

export const USE_COLORS: Record<BuildingUse, RGB> = {
  affordable_housing: hex('#e07a3f'),
  mixed_use: hex('#d9a441'),
  community_center: hex('#2a9d8f'),
  school: hex('#e9c46a'),
  clinic: hex('#8ecae6'),
};

export const CAR_COLORS = ['#2b2d42', '#8d99ae', '#edf2f4', '#ef233c', '#1d3557', '#f4a261', '#6c757d'].map(hex);
