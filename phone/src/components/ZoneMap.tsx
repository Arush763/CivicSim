import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Dimensions, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Marker, Polygon, type MapPressEvent } from 'react-native-maps';
import { useTheme } from '@/lib/settings';
import { alpha, type Theme } from '@/lib/theme';
import { T } from './ui';

export interface MapZone {
  id: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  state?: 'waiting' | 'approved' | 'selected';
  badge?: number;
}

export interface Camera {
  center: [number, number]; // [lng, lat]
  zoom: number;
  tilt?: number;
  heading?: number;
}

export interface ZoneMapHandle {
  flyTo: (c: Camera, ms?: number) => void;
  setTilt: (deg: number) => void;
  north: () => void;
}

/** Zoom at which the zone grid is drawn and a tap opens the zone under it. */
export const GRID_ZOOM = 15.5;
/** Where the map opens until we know where you are: lower Manhattan (zones work anywhere). */
export const PILOT_CAMERA: Camera = { center: [-73.997, 40.7255], zoom: 16, tilt: 0, heading: 0 };

/** Apple Maps works in camera altitude, Google Maps in zoom; this keeps them roughly in step. */
const altitudeFor = (zoom: number) => 40_000_000 / 2 ** zoom;
const toNative = (c: Camera) => ({
  center: { longitude: c.center[0], latitude: c.center[1] },
  zoom: c.zoom,
  altitude: altitudeFor(c.zoom),
  pitch: c.tilt ?? 0,
  heading: c.heading ?? 0,
});

/** Google's night style, for Android (iOS follows userInterfaceStyle). */
const DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1b1c1e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9aa0a6' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1b1c1e' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#34373b' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#4a3f1f' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1c3a28' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f2c4a' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#2c2f33' }] },
];

const look = (c: Theme, s: MapZone['state']) =>
  s === 'waiting' ? { stroke: c.zoneWait, fill: alpha(c.zoneWait, 0.18), width: 1.5 }
  : s === 'approved' ? { stroke: c.zoneOk, fill: alpha(c.zoneOk, 0.18), width: 1.5 }
  : s === 'selected' ? { stroke: c.zoneSel, fill: alpha(c.zoneSel, 0.16), width: 3 }
  : { stroke: alpha(c.dark ? '#E8EAED' : '#3C4043', c.dark ? 0.3 : 0.35), fill: 'rgba(0,0,0,0)', width: 1 };

/** Zoomed out further than this, the map becomes the 3D globe seen from space. */
const GLOBE_ZOOM = 7;

/**
 * The phone map (Google Maps on Android, Apple Maps on iOS in Expo Go). Zones are squares on the
 * ground; zones with requests are tinted with a count badge, the selected one is blue.
 */
export const ZoneMap = forwardRef<ZoneMapHandle, {
  zones: MapZone[];
  initialCamera: Camera;
  buildings: boolean;
  onZonePress?: (id: string) => void;
  onMapPress?: (lng: number, lat: number) => void;
  onViewChange?: (bbox: [number, number, number, number], zoom: number) => void;
  showsUser?: boolean;
  style?: StyleProp<ViewStyle>;
}>(function ZoneMap({ zones, initialCamera, buildings, onZonePress, onMapPress, onViewChange, showsUser, style }, ref) {
  const c = useTheme();
  const map = useRef<MapView>(null);
  // Far out: Apple's 3D satellite globe, seen from space. Closer in: the normal map, tilted, with
  // 3D buildings for depth. (Google Maps on Android has no globe: terrain relief there instead.)
  const [far, setFar] = useState(initialCamera.zoom < GLOBE_ZOOM);
  const mapType = far ? (Platform.OS === 'ios' ? 'hybridFlyover' : 'terrain') : 'standard';

  useImperativeHandle(ref, () => ({
    flyTo: (cam, ms = 700) => map.current?.animateCamera(toNative(cam), { duration: ms }),
    setTilt: async (deg) => {
      const cam = await map.current?.getCamera();
      if (cam) map.current?.animateCamera({ ...cam, pitch: deg }, { duration: 600 });
    },
    north: async () => {
      const cam = await map.current?.getCamera();
      if (cam) map.current?.animateCamera({ ...cam, heading: 0 }, { duration: 400 });
    },
  }));

  return (
    <View style={[{ overflow: 'hidden', backgroundColor: c.bg }, style]}>
      <MapView
        ref={map}
        style={{ flex: 1 }}
        initialCamera={toNative(initialCamera)}
        mapType={mapType}
        showsBuildings={buildings}
        showsUserLocation={showsUser}
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterests
        pitchEnabled
        rotateEnabled
        toolbarEnabled={false}
        userInterfaceStyle={c.dark ? 'dark' : 'light'}
        customMapStyle={Platform.OS === 'android' && c.dark ? DARK_STYLE : undefined}
        onPress={(e: MapPressEvent) => {
          if (e.nativeEvent.action === 'marker-press') return;
          onMapPress?.(e.nativeEvent.coordinate.longitude, e.nativeEvent.coordinate.latitude);
        }}
        onRegionChangeComplete={(r) => {
          // Region → zoom, in Google's web-map zoom levels, so both platforms share thresholds.
          const zoom = Math.log2((360 * (Dimensions.get('window').width / 256)) / Math.max(1e-9, r.longitudeDelta));
          setFar(zoom < GLOBE_ZOOM);
          onViewChange?.([r.longitude - r.longitudeDelta / 2, r.latitude - r.latitudeDelta / 2, r.longitude + r.longitudeDelta / 2, r.latitude + r.latitudeDelta / 2], zoom);
        }}
      >
        {zones.map((z) => {
          const l = look(c, z.state);
          const [w, s, e, n] = z.bbox;
          return (
            <Polygon
              key={`${z.id}-${z.state ?? 'idle'}-${c.dark}`}
              coordinates={[{ latitude: s, longitude: w }, { latitude: s, longitude: e }, { latitude: n, longitude: e }, { latitude: n, longitude: w }]}
              strokeColor={l.stroke}
              strokeWidth={l.width}
              fillColor={l.fill}
              lineDashPattern={z.state === 'selected' ? [10, 4] : z.state ? undefined : [3, 3]}
              tappable={!!onZonePress}
              onPress={() => onZonePress?.(z.id)}
              zIndex={z.state === 'selected' ? 3 : z.state ? 2 : 1}
            />
          );
        })}
        {zones
          .filter((z) => z.badge)
          .map((z) => {
            const [, s, e, n] = z.bbox;
            const bg = z.state === 'selected' ? c.badgeSel : z.state === 'approved' ? c.badgeOk : c.badgeWait;
            return (
              <Marker
                key={`b-${z.id}-${z.state}-${z.badge}-${c.dark}`}
                // Top-right corner of the zone, like the design.
                coordinate={{ latitude: n - (n - s) * 0.12, longitude: e - (e - z.bbox[0]) * 0.12 }}
                onPress={() => onZonePress?.(z.id)}
                tracksViewChanges={false}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View style={{ minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: bg }}>
                  <T size={12} weight="bold" color={c.onBadge}>{z.badge}</T>
                </View>
              </Marker>
            );
          })}
      </MapView>
    </View>
  );
});
