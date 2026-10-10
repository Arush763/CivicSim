import { Alert, Linking, Platform } from 'react-native';

export type TravelMode = 'walking' | 'transit' | 'bicycling' | 'driving';

export const TRAVEL_MODES: { mode: TravelMode; label: string }[] = [
  { mode: 'walking', label: 'Walk' },
  { mode: 'transit', label: 'Transit' },
  { mode: 'bicycling', label: 'Bike' },
  { mode: 'driving', label: 'Drive' },
];

const googleUrl = (lat: number, lng: number, mode: TravelMode) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=${mode}`;

const appleFlag: Record<TravelMode, string> = { walking: 'w', transit: 'r', bicycling: 'w', driving: 'd' };
const appleUrl = (lat: number, lng: number, mode: TravelMode) => `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=${appleFlag[mode]}`;

/**
 * Turn-by-turn directions from where you are to a point, handed to Google Maps (or, on
 * iPhone, your choice of Apple Maps or Google Maps).
 */
export function openDirections(lat: number, lng: number, mode: TravelMode) {
  if (Platform.OS === 'web') {
    window.open(googleUrl(lat, lng, mode), '_blank', 'noopener');
    return;
  }
  if (Platform.OS === 'ios') {
    Alert.alert('Get directions', 'Open in…', [
      { text: 'Apple Maps', onPress: () => void Linking.openURL(appleUrl(lat, lng, mode)) },
      { text: 'Google Maps', onPress: () => void Linking.openURL(googleUrl(lat, lng, mode)) },
      { text: 'Cancel', style: 'cancel' },
    ]);
    return;
  }
  void Linking.openURL(googleUrl(lat, lng, mode));
}
