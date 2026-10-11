import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { dark, light, type Theme } from './theme';

export type ThemeChoice = 'light' | 'dark' | 'system';
/** Map quality: 0 Low, 1 Balanced, 2 High, 3 Ultra. */
export type Quality = 0 | 1 | 2 | 3;

export interface Settings {
  theme: ThemeChoice;
  quality: Quality;
  /** Photo-real (AI-edited) Street View. Off: plain Street View, faster on weak connections. */
  photoReal: boolean;
}

const DEFAULTS: Settings = { theme: 'system', quality: 2, photoReal: true };
const KEY = 'civicsim.settings';

export const QUALITY_NAMES = ['Low', 'Balanced', 'High', 'Ultra'] as const;
export const QUALITY_CAPTIONS = [
  'Smoothest on older or low-power phones. Flat map and simple models.',
  '3D buildings with lighter models. Good for mid-range phones.',
  'Default. Sharper 3D models with shadows.',
  'Best visuals with full-detail models. Uses more battery and data.',
];
/** What each quality level changes (the 3D model page reads the same table: server/public/model.html). */
export const QUALITY_SPECS: [string, string[]][] = [
  ['3D model detail', ['Low', 'Medium', 'High', 'Full']],
  ['3D buildings on map', ['Off', 'On', 'On', 'On']],
  ['Shadows in 3D model', ['Off', 'Off', 'On', 'On']],
  ['Frame rate', ['30 fps', '30 fps', '60 fps', '60 fps']],
];

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void;
  theme: ThemeChoice;
  /** The colours in use now (the choice, or the phone's own setting for "System"). */
  colors: Theme;
}

const Ctx = createContext<SettingsState | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const system = useColorScheme();

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setS({ ...DEFAULTS, ...JSON.parse(raw) }))
      .catch(() => {});
  }, []);

  const value = useMemo<SettingsState>(() => {
    const isDark = s.theme === 'dark' || (s.theme === 'system' && system === 'dark');
    return {
      ...s,
      colors: isDark ? dark : light,
      set: (patch) =>
        setS((cur) => {
          const next = { ...cur, ...patch };
          void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
          return next;
        }),
    };
  }, [s, system]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}

export const useTheme = (): Theme => useSettings().colors;
