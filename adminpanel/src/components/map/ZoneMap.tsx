import * as Location from 'expo-location';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Alert, Dimensions, Text, View } from 'react-native';
import MapView, { Marker, Polygon } from 'react-native-maps';
import { fonts, shadow, useTheme } from '@/lib/theme';
import { Icon } from '../icons';
import { IconButton } from '../ui';
import { ZONE_COLORS, type Camera, type ZoneMapHandle, type ZoneMapProps } from './types';

/** Apple Maps works in camera altitude, Google Maps in zoom; this keeps them roughly in step. */
const altitudeFor = (zoom: number) => 40_000_000 / 2 ** zoom;

const toNative = (c: Camera) => ({
  center: { longitude: c.center[0], latitude: c.center[1] },
  zoom: c.zoom,
  altitude: altitudeFor(c.zoom),
  pitch: c.tilt ?? 0,
  heading: c.heading ?? 0,
});

const hexA = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/**
 * Phone version: the platform map (Google Maps on Android, Apple Maps on iOS in Expo Go),
 * tilted with 3D buildings. Zones are polygons on the ground; zones with requests are tinted
 * and carry a count badge. (Browser version: ZoneMap.web.tsx.)
 */
export const ZoneMap = forwardRef<ZoneMapHandle, ZoneMapProps>(function ZoneMap(
  { zones, onZonePress, onMapPress, onViewChange, initialCamera, focus, controls = { right: 16, bottom: 24 }, quietGrid, style },
  ref,
) {
  const t = useTheme();
  const map = useRef<MapView>(null);
  const [tilted, setTilted] = useState((initialCamera.tilt ?? 0) > 0);
  const [showMe, setShowMe] = useState(false);

  const flyTo = (c: Camera) => map.current?.animateCamera(toNative(c), { duration: 700 });
  useImperativeHandle(ref, () => ({ flyTo }));

  useEffect(() => {
    if (focus) flyTo(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.center.join(','), focus?.zoom, focus?.tilt, focus?.heading]);

  const locate = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Location is off', 'Allow location access in Settings to see where you are on the map.');
      return;
    }
    setShowMe(true);
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 17, tilt: tilted ? 45 : 0 });
  };

  const setTilt = async (on: boolean) => {
    setTilted(on);
    const cam = await map.current?.getCamera();
    if (cam) map.current?.animateCamera({ ...cam, pitch: on ? 45 : 0 }, { duration: 400 });
  };

  return (
    <View style={[{ overflow: 'hidden', backgroundColor: '#E8EAED' }, style]}>
      <MapView
        ref={map}
        style={{ flex: 1 }}
        initialCamera={toNative(initialCamera)}
        showsBuildings
        showsUserLocation={showMe}
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterests
        pitchEnabled
        rotateEnabled
        toolbarEnabled={false}
        onPress={(e) => {
          // Badge taps are handled by the badge. (A zone polygon tap may arrive here too; callers de-duplicate.)
          if (e.nativeEvent.action === 'marker-press') return;
          onMapPress?.(e.nativeEvent.coordinate.longitude, e.nativeEvent.coordinate.latitude);
        }}
        onRegionChangeComplete={(r) => {
          // Region → zoom, in Google's web-map zoom levels, so both platforms share thresholds.
          const zoom = Math.log2((360 * (Dimensions.get('window').width / 256)) / Math.max(1e-9, r.longitudeDelta));
          onViewChange?.([r.longitude - r.longitudeDelta / 2, r.latitude - r.latitudeDelta / 2, r.longitude + r.longitudeDelta / 2, r.latitude + r.latitudeDelta / 2], zoom);
        }}
      >
        {zones.map((z) => {
          if (quietGrid && !z.state) return null;
          const look = ZONE_COLORS[z.state ?? 'idle'];
          const [w, s, e, n] = z.bbox;
          return (
            <Polygon
              key={z.id}
              coordinates={[
                { latitude: s, longitude: w },
                { latitude: s, longitude: e },
                { latitude: n, longitude: e },
                { latitude: n, longitude: w },
              ]}
              strokeColor={hexA(look.stroke, look.strokeOpacity)}
              strokeWidth={z.state === 'selected' ? 3 : z.state ? 2 : 1}
              fillColor={hexA(look.fill, look.fillOpacity)}
              tappable={!!onZonePress}
              onPress={() => onZonePress?.(z.id)}
              zIndex={z.state ? 2 : 1}
            />
          );
        })}
        {zones
          .filter((z) => z.badge)
          .map((z) => {
            const [w, s, e, n] = z.bbox;
            return (
              <Marker
                key={`b-${z.id}`}
                coordinate={{ latitude: (s + n) / 2, longitude: (w + e) / 2 }}
                onPress={() => onZonePress?.(z.id)}
                tracksViewChanges={false}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View style={[{ minWidth: 28, height: 28, paddingHorizontal: 8, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff', backgroundColor: z.state === 'approved' ? t.approved : t.waiting }, shadow]}>
                  <Text style={{ color: '#fff', fontFamily: fonts.bodyBold, fontSize: 13 }}>{z.badge}</Text>
                </View>
              </Marker>
            );
          })}
      </MapView>
      {controls && (
        <View style={{ position: 'absolute', right: controls.right, bottom: controls.bottom, top: controls.top, gap: 10 }} pointerEvents="box-none">
          <IconButton label="My location" onPress={locate} tint="#FFFFFF" style={[{ borderColor: 'transparent' }, shadow]}>
            <Icon name="locate" size={20} color={t.accent} />
          </IconButton>
          <IconButton label={tilted ? 'Show flat map' : 'Show 3D buildings'} onPress={() => setTilt(!tilted)} tint="#FFFFFF" style={[{ borderColor: 'transparent' }, shadow]}>
            <Text style={{ color: t.text, fontFamily: fonts.bodyBold, fontSize: 13 }}>{tilted ? '2D' : '3D'}</Text>
          </IconButton>
          <IconButton
            label="Point north"
            onPress={async () => {
              const cam = await map.current?.getCamera();
              if (cam) map.current?.animateCamera({ ...cam, heading: 0 }, { duration: 400 });
            }}
            tint="#FFFFFF"
            style={[{ borderColor: 'transparent' }, shadow]}
          >
            <Icon name="compass" size={20} color={t.text} />
          </IconButton>
        </View>
      )}
    </View>
  );
});
