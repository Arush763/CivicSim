import type { AreaDetail, ChangeOp } from '@mamdani/shared';
import { Platform, View } from 'react-native';
import MapView, { Marker, Polygon, Polyline, type LatLng } from 'react-native-maps';
import type { PickKind } from '@/lib/ops';
import { MapIn } from './ui';
import { useSettings } from '@/lib/settings';
import { alpha } from '@/lib/theme';

const ll = ([lng, lat]: [number, number]): LatLng => ({ latitude: lat, longitude: lng });

/** How each kind of change is drawn on the pick map. */
const OP_COLOR: Record<ChangeOp['type'], string> = {
  add_bike_lane: '#188038',
  add_bus_lane: '#C5221F',
  widen_sidewalk: '#9AA0A6',
  remove_parking: '#E37400',
  replace_building: '#1A73E8',
  add_park: '#34A853',
  plant_trees: '#137333',
  add_crosswalk: '#202124',
};

/**
 * The zone on the real map, for placing changes: streets light up to tap when a street change is
 * picked, buildings when rebuilding a lot, and parks and trees are tapped out point by point.
 * Changes already in the request are drawn in their own colours.
 */
export function PickerMap({ area, ops, pick, treeShape, points, onStreet, onBuilding, onPoint, blockedStreet, blockedBuilding, onBlocked, height = 250 }: {
  area: AreaDetail;
  ops: ChangeOp[];
  pick: PickKind | null;
  treeShape: 'line' | 'area';
  points: [number, number][];
  onStreet: (id: string) => void;
  onBuilding: (id: string) => void;
  onPoint: (p: [number, number]) => void;
  /** Why the change being placed can't go on this street or building (greyed out), or null. */
  blockedStreet?: (id: string) => string | null;
  blockedBuilding?: (id: string) => string | null;
  onBlocked?: (reason: string) => void;
  height?: number;
}) {
  const { colors: c } = useSettings();
  const [w, s, e, n] = area.bbox;
  const streetOps = new Map<string, string>();
  for (const op of ops) if ('streetSegmentId' in op) streetOps.set(op.streetSegmentId, OP_COLOR[op.type]);
  const rebuilt = new Set(ops.flatMap((op) => (op.type === 'replace_building' ? [op.buildingId] : [])));

  return (
    <MapIn style={{ height, backgroundColor: c.bg }}>
      <MapView
        style={{ flex: 1 }}
        initialRegion={{ latitude: (s + n) / 2, longitude: (w + e) / 2, latitudeDelta: (n - s) * 1.25, longitudeDelta: (e - w) * 1.25 }}
        showsPointsOfInterests={false}
        showsBuildings={false}
        toolbarEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        userInterfaceStyle={c.dark ? 'dark' : 'light'}
        onPress={(ev) => {
          // Streets and buildings are only tappable while picking them, so a tap here is always a point.
          if ((ev.nativeEvent.action as string | undefined) === 'marker-press') return;
          if (pick === 'point' || pick === 'polygon' || pick === 'line_or_polygon') onPoint([ev.nativeEvent.coordinate.longitude, ev.nativeEvent.coordinate.latitude]);
        }}
      >
        <Polygon coordinates={[ll([w, s]), ll([e, s]), ll([e, n]), ll([w, n])]} strokeColor={c.accent} strokeWidth={2.5} fillColor={alpha(c.accent, 0.06)} lineDashPattern={Platform.OS === 'ios' ? [10, 4] : undefined} />

        {area.scene.buildings.map((b) => {
          const on = rebuilt.has(b.id);
          if (pick !== 'building' && !on) return null;
          const why = pick === 'building' && !on ? blockedBuilding?.(b.id) ?? null : null;
          return (
            <Polygon key={b.id} tappable={pick === 'building'} onPress={() => (why ? onBlocked?.(why) : onBuilding(b.id))} coordinates={b.ring.map(ll)}
              fillColor={on ? alpha('#1A73E8', 0.55) : why ? alpha(c.text3, 0.12) : alpha(c.accent, 0.1)} strokeColor={on ? '#1A73E8' : why ? alpha(c.text3, 0.3) : alpha(c.accent, 0.5)} strokeWidth={1} zIndex={2} />
          );
        })}

        {area.scene.streets.map((st) => {
          const color = streetOps.get(st.id);
          if (pick !== 'street' && !color) return null;
          const why = pick === 'street' ? blockedStreet?.(st.id) ?? null : null;
          return (
            <Polyline key={st.id} tappable={pick === 'street'} onPress={() => (why ? onBlocked?.(why) : onStreet(st.id))} coordinates={st.line.map(ll)}
              strokeColor={color ?? (why ? alpha(c.text3, 0.22) : alpha(c.accent, 0.35))} strokeWidth={color ? 6 : why ? 6 : 10} zIndex={color ? 4 : 3} lineCap="round"
              lineDashPattern={why && !color ? [4, 6] : undefined} />
          );
        })}

        {ops.map((op, i) => {
          if (op.type === 'add_park') return <Polygon key={`p${i}`} coordinates={op.polygon.map(ll)} fillColor={alpha('#34A853', 0.4)} strokeColor="#188038" strokeWidth={2} zIndex={2} />;
          if (op.type === 'plant_trees' && op.polygon) return <Polygon key={`t${i}`} coordinates={op.polygon.map(ll)} fillColor={alpha('#137333', 0.25)} strokeColor="#137333" strokeWidth={2} lineDashPattern={[4, 4]} zIndex={2} />;
          if (op.type === 'plant_trees' && op.line) return <Polyline key={`t${i}`} coordinates={op.line.map(ll)} strokeColor="#137333" strokeWidth={5} lineDashPattern={[2, 8]} lineCap="round" zIndex={4} />;
          if (op.type === 'add_crosswalk')
            return (
              <Marker key={`x${i}`} coordinate={ll(op.at)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                <View style={{ width: 22, height: 14, borderRadius: 2, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#202124' }} />
              </Marker>
            );
          return null;
        })}

        {/* The change being placed now. */}
        {(pick === 'polygon' || (pick === 'line_or_polygon' && treeShape === 'area')) && points.length >= 3 && (
          <Polygon coordinates={points.map(ll)} fillColor={alpha(c.accent, 0.25)} strokeColor={c.accent} strokeWidth={2} zIndex={5} />
        )}
        {(pick === 'polygon' || pick === 'line_or_polygon') && points.length >= 2 && (pick === 'polygon' || treeShape === 'area' ? points.length < 3 : true) && (
          <Polyline coordinates={points.map(ll)} strokeColor={c.accent} strokeWidth={4} zIndex={5} />
        )}
        {points.map((p, i) => (
          <Marker key={`m${i}`} coordinate={ll(p)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c.accent, borderWidth: 2, borderColor: '#FFFFFF' }} />
          </Marker>
        ))}
      </MapView>
    </MapIn>
  );
}
