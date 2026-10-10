import { zoneBbox } from '@mamdani/shared';
import { useWindowDimensions } from 'react-native';

/**
 * A light, real-map look in the style of Google Maps: white panels, grey text,
 * one blue accent. Zone states use the familiar map signal colours.
 */
const palette = {
  bg: '#FFFFFF',
  page: '#F8F9FA', // behind cards on list screens
  water: '#AADAFF', // fallback behind maps while they load
  card: '#FFFFFF',
  inner: '#F8F9FA', // cards inside cards
  raised: '#F1F3F4', // pressed / hover
  nav: '#FFFFFF',
  border: '#DADCE0',
  borderStrong: '#BDC1C6',
  divider: '#E8EAED',
  text: '#202124',
  soft: '#3C4043',
  muted: '#5F6368',
  accent: '#1A73E8', // Google blue: actions, links, selection
  accentText: '#FFFFFF',
  forest: '#E8F0FE', // light blue tint (selected chips, highlighted stats)
  forestLine: '#AECBFA',
  waiting: '#E37400', // zone has requests waiting
  waitingTint: '#FEF7E0',
  waitingLine: '#FBD27D',
  approved: '#188038', // approved
  approvedTint: '#E6F4EA',
  danger: '#D93025',
  ai: '#8430CE',
  aiLine: '#D7AEFB',
  // Older names some screens still use.
  deep: '#E37400',
  good: '#188038',
  warn: '#E37400',
  sky: '#E8EAED',
};

export type Theme = typeof palette;

export function useTheme(): Theme {
  return palette;
}

/** Font families loaded in the root layout (React Native picks weight by family name). */
export const fonts = {
  display: 'Roboto_700Bold',
  displayBold: 'Roboto_500Medium',
  body: 'Roboto_400Regular',
  bodyMedium: 'Roboto_500Medium',
  bodySemi: 'Roboto_500Medium',
  bodyBold: 'Roboto_700Bold',
  mono: 'RobotoMono_400Regular',
  monoMedium: 'RobotoMono_500Medium',
};

/** Soft elevation used for floating panels over the map. */
export const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.18,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 4,
} as const;

/** Desktop layout (top navigation, side panels) from this width up. */
export const WIDE = 1024;
export function useIsWide(): boolean {
  return useWindowDimensions().width >= WIDE;
}

export const money = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`;

/** "r09c14" → "R09·C14" */
/** How a zone is labelled: its centre's coordinates (older New York pilot zones keep their grid code, R09·C14). */
export const zoneCode = (id: string) => {
  const b = zoneBbox(id);
  if (!b) return id.toUpperCase().replace(/^(R\d+)(C\d+)$/, '$1·$2');
  const lat = (b[1] + b[3]) / 2;
  const lng = (b[0] + b[2]) / 2;
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
};

export const ISSUE_LABELS: Record<string, string> = {
  street_condition: 'Street & sidewalk condition',
  noise: 'Noise',
  heat_hot_water: 'Heat / hot water',
  sanitation: 'Sanitation & rodents',
  traffic_safety: 'Traffic safety',
  parking: 'Parking',
  trees_parks: 'Trees & parks',
  housing_condition: 'Housing conditions',
  homelessness: 'Homelessness',
  other: 'Other',
};
