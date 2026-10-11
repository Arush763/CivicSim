import type { ConfigContext, ExpoConfig } from 'expo/config';

// The residents' phone app. (The city admin panel is the separate app in ../adminpanel.)
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'CivicSim',
  slug: 'civicsim',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'civicsim',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'org.civicsim.app',
    infoPlist: { NSLocationWhenInUseUsageDescription: 'CivicSim shows requests near you and opens the map where you are.' },
  },
  android: {
    package: 'org.civicsim.app',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    // Expo Go brings its own Google Maps key; store builds use this one (kept out of git, in .env).
    config: { googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '' } },
  },
  plugins: [
    'expo-router',
    'expo-font',
    ['expo-location', { locationWhenInUsePermission: 'CivicSim shows requests near you and opens the map where you are.' }],
  ],
  experiments: { typedRoutes: true },
  // The Expo (EAS) project the Android test build is made in.
  extra: { eas: { projectId: 'd76d0ab8-7d2c-4609-a449-7ada3596f8cc' } },
  owner: 'zpurplex',
});
