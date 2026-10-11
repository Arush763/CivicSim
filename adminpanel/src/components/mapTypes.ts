import type { Area } from '@mamdani/shared';

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** One clickable zone on the overview map. */
export interface Zone {
  area: Area;
  fill: string;
  stroke: string;
  badge?: { text: string; color: string };
}
