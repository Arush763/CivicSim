/**
 * The complaint heat map: zones by how many 311 complaints they had in the last 90 days.
 * Thresholds split New York's zones roughly 45% green, 35% yellow, 20% red.
 */
export type HeatLevel = 'none' | 'low' | 'medium' | 'high';

export function heatLevel(complaints: number | null | undefined): HeatLevel {
  if (!complaints || complaints <= 0) return 'none';
  if (complaints < 100) return 'low';
  if (complaints < 250) return 'medium';
  return 'high';
}

/** Green, yellow and red, readable over both the light map and the satellite globe. */
export const HEAT_COLORS: Record<Exclude<HeatLevel, 'none'>, string> = {
  low: '#34A853',
  medium: '#FBBC04',
  high: '#EA4335',
};

export const HEAT_LABELS: Record<Exclude<HeatLevel, 'none'>, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/** What the colours mean (311 complaints where cities publish them; street need elsewhere). */
export const HEAT_NOTE = 'Complaints in NYC, Chicago and SF · street needs elsewhere';

/** Zoomed in at least this far, the apps ask the server for the heat of every zone in view. */
export const HEAT_ZOOM = 13.5;
