import { zoneBbox } from '@mamdani/shared';
import { useColorScheme, useWindowDimensions } from 'react-native';

/**
 * The CivicSim Desktop design: a grey page, white cards, one blue accent, and the familiar
 * map signal colours for request states. Light and dark follow the computer's setting.
 */
const light = {
  bg: '#F1F3F4', // the page, behind cards
  page: '#F1F3F4',
  water: '#AADAFF', // fallback behind maps while they load
  card: '#FFFFFF',
  inner: '#F8F9FA', // cards inside cards
  raised: '#F1F3F4', // pressed / hover, search field
  nav: '#FFFFFF',
  border: '#E3E5E8',
  borderStrong: '#DADCE0',
  divider: '#E3E5E8',
  text: '#202124',
  soft: '#3C4043',
  muted: '#5F6368',
  accent: '#1A73E8', // actions, selection
  accentText: '#FFFFFF',
  link: '#1967D2',
  forest: '#E8F0FE', // selected chips and nav items, highlighted stats
  forestText: '#174EA6',
  forestLine: '#AECBFA',
  waiting: '#E37400', // submitted, waiting for a decision
  waitingTint: '#FEF0DB',
  waitingText: '#8A4500',
  waitingLine: '#FBD27D',
  review: '#1A73E8',
  reviewTint: '#E8F0FE',
  reviewText: '#174EA6',
  approved: '#188038',
  approvedTint: '#E6F4EA',
  approvedText: '#0D652D',
  approvedLine: '#A8DAB5',
  onApproved: '#FFFFFF',
  danger: '#D93025',
  dangerTint: '#FCE8E6',
  dangerText: '#A50E0E',
  ai: '#681DA8',
  aiTint: '#F3E8FD',
  aiLine: '#D7AEFB',
  // Older names some screens still use.
  deep: '#E37400',
  good: '#188038',
  warn: '#E37400',
  sky: '#E8EAED',
  dark: false,
};

const dark: typeof light = {
  bg: '#131314',
  page: '#131314',
  water: '#1C2A3A',
  card: '#1F1F21',
  inner: '#2A2B2E',
  raised: '#2A2B2E',
  nav: '#1F1F21',
  border: '#2D2E31',
  borderStrong: '#44474A',
  divider: '#2D2E31',
  text: '#E8EAED',
  soft: '#C4C7C5',
  muted: '#A9AEB3',
  accent: '#8AB4F8',
  accentText: '#062E6F',
  link: '#8AB4F8',
  forest: '#1F3760',
  forestText: '#A8C7FA',
  forestLine: '#3B5A8C',
  waiting: '#F9AB00',
  waitingTint: '#4A2C05',
  waitingText: '#FDD097',
  waitingLine: '#7A4A0A',
  review: '#8AB4F8',
  reviewTint: '#1F3760',
  reviewText: '#A8C7FA',
  approved: '#81C995',
  approvedTint: '#0F3D1F',
  approvedText: '#A8DAB5',
  approvedLine: '#2E6B3E',
  onApproved: '#0D2818',
  danger: '#F28B82',
  dangerTint: '#5C1E1A',
  dangerText: '#F6AEA9',
  ai: '#E1C2FA',
  aiTint: '#3B2152',
  aiLine: '#6B4A8A',
  deep: '#F9AB00',
  good: '#81C995',
  warn: '#F9AB00',
  sky: '#2D2E31',
  dark: true,
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
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
