import type { AreaDetail } from '@mamdani/shared';
import { useMemo } from 'react';
import { View } from 'react-native';
import MapView, { Marker, Polygon, Polyline, type LatLng } from 'react-native-maps';
import type { PickKind } from '@/lib/ops';

export interface PickerMapProps {
  area: AreaDetail;
  pick: PickKind | null;
  treeShape: 'line' | 'area';
  streetId: string | null;
  buildingId: string | null;
  points: LatLng[];
  onStreet: (id: string) => void;
  onBuilding: (id: string) => void;
  onMapPress: (p: LatLng) => void;
  /** px, or 'fill' to fill the parent. */
  height?: number | 'fill';
}

const BLUE = '#1A73E8';
const blue = (a: number) => `rgba(26,115,232,${a})`;
const ll = ([lng, lat]: [number, number]): LatLng => ({ latitude: lat, longitude: lng });

/**
 * Phone version of the pick map (browser version: PickerMap.web.tsx): the real map of the zone,
 * with its streets and buildings as tappable overlays.
 */
export function PickerMap({ area, pick, treeShape, streetId, buildingId, points, onStreet, onBuilding, onMapPress, height = 240 }: PickerMapProps) {
  const [w, s, e, n] = area.bbox;
  const region = useMemo(
    () => ({ latitude: (s + n) / 2, longitude: (w + e) / 2, latitudeDelta: (n - s) * 1.3, longitudeDelta: (e - w) * 1.3 }),
    [w, s, e, n],
  );
  const drawing = pick === 'polygon' || pick === 'line_or_polygon';

  return (
    <View style={{ height: height === 'fill' ? undefined : height, flex: height === 'fill' ? 1 : undefined, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#DADCE0' }}>
      <MapView
        style={{ flex: 1 }}
        initialRegion={region}
        showsPointsOfInterests={false}
        showsBuildings={false}
        toolbarEnabled={false}
        onPress={(ev) => onMapPress(ev.nativeEvent.coordinate)}
      >
        <Polygon coordinates={[ll([w, s]), ll([e, s]), ll([e, n]), ll([w, n])]} strokeColor={blue(0.6)} strokeWidth={2} fillColor="transparent" />
        {pick === 'building' &&
          area.scene.buildings.map((b) => (
            <Polygon
              key={b.id}
              tappable
              onPress={() => onBuilding(b.id)}
              coordinates={b.ring.map(ll)}
              fillColor={b.id === buildingId ? blue(0.55) : blue(0.08)}
              strokeColor={b.id === buildingId ? BLUE : blue(0.5)}
              strokeWidth={1}
            />
          ))}
        {area.scene.streets.map((st) => {
          const selected = st.id === streetId;
          if (pick !== 'street' && !selected) return null;
          return (
            <Polyline
              key={st.id}
              tappable={pick === 'street'}
              onPress={() => onStreet(st.id)}
              coordinates={st.line.map(ll)}
              strokeColor={selected ? BLUE : blue(0.35)}
              strokeWidth={selected ? 8 : 7}
              zIndex={selected ? 3 : 2}
            />
          );
        })}
        {drawing && (pick === 'polygon' || treeShape === 'area') && points.length >= 3 && (
          <Polygon coordinates={points} fillColor={blue(0.25)} strokeColor={BLUE} strokeWidth={2} />
        )}
        {pick === 'line_or_polygon' && treeShape === 'line' && points.length >= 2 && <Polyline coordinates={points} strokeColor={BLUE} strokeWidth={5} />}
        {(drawing || pick === 'point') &&
          points.map((p, i) => (
            <Marker key={i} coordinate={p} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: BLUE, borderWidth: 2, borderColor: '#fff' }} />
            </Marker>
          ))}
      </MapView>
    </View>
  );
}
