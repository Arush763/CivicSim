import { BuildingUse, ChangeOp, type AreaDetail } from '@mamdani/shared';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { OP_PICK, OP_TYPES, type PickKind } from '@/lib/ops';
import { fonts, useTheme } from '@/lib/theme';
import type { LatLng } from './mapTypes';
import { PickerMap } from './PickerMap';
import { Button, Chip, Label, Mono, Muted } from './ui';

type OpType = ChangeOp['type'];

/** Short labels for the type grid, as in the design. */
const TYPE_LABEL: Record<OpType, string> = {
  add_bike_lane: 'Bike lane',
  add_bus_lane: 'Bus lane',
  add_park: 'Park',
  plant_trees: 'Trees',
  replace_building: 'Rebuild lot',
  widen_sidewalk: 'Sidewalk',
  add_crosswalk: 'Crosswalk',
  remove_parking: 'No parking',
};

export interface BuilderState {
  type: OpType | null;
  streetId: string | null;
  buildingId: string | null;
  points: LatLng[];
  treeShape: 'line' | 'area';
  bothSides: boolean;
  isProtected: boolean;
  meters: number;
  floors: number;
  use: BuildingUse;
  units: number;
  count: number;
  raised: boolean;
  name: string;
}

export const EMPTY_BUILDER: BuilderState = {
  type: null, streetId: null, buildingId: null, points: [], treeShape: 'line', bothSides: true, isProtected: true,
  meters: 1.5, floors: 8, use: 'affordable_housing', units: 0, count: 10, raised: false, name: '',
};

const pair = (p: LatLng): [number, number] => [p.longitude, p.latitude];

/** The change described by the builder, or null while something still needs picking. */
export function buildOp(s: BuilderState): ChangeOp | null {
  const side = s.bothSides ? 'both' : 'right';
  const raw = (() => {
    switch (s.type) {
      case 'add_bike_lane': return { type: s.type, streetSegmentId: s.streetId, side, protected: s.isProtected };
      case 'add_bus_lane': return { type: s.type, streetSegmentId: s.streetId, side };
      case 'widen_sidewalk': return { type: s.type, streetSegmentId: s.streetId, meters: s.meters };
      case 'remove_parking': return { type: s.type, streetSegmentId: s.streetId, side };
      case 'replace_building': return { type: s.type, buildingId: s.buildingId, floors: s.floors, use: s.use, units: s.use === 'affordable_housing' ? s.units : 0 };
      case 'add_park': return { type: s.type, polygon: s.points.map(pair), ...(s.name.trim() ? { name: s.name.trim() } : {}) };
      case 'plant_trees': return s.treeShape === 'line' ? { type: s.type, count: s.count, line: s.points.map(pair) } : { type: s.type, count: s.count, polygon: s.points.map(pair) };
      case 'add_crosswalk': return { type: s.type, at: s.points[0] ? pair(s.points[0]) : undefined, raised: s.raised };
      default: return null;
    }
  })();
  const r = ChangeOp.safeParse(raw);
  return r.success ? r.data : null;
}

export function pickLabel(pick: PickKind | null, treeShape: 'line' | 'area') {
  switch (pick) {
    case 'street': return '2 · TAP THE STREET';
    case 'building': return '2 · TAP THE BUILDING';
    case 'point': return '2 · TAP WHERE IT GOES';
    case 'polygon': return '2 · TAP THE CORNERS';
    case 'line_or_polygon': return treeShape === 'line' ? '2 · TAP ALONG THE SIDEWALK' : '2 · TAP THE CORNERS';
    default: return '2 · PICK ON THE MAP';
  }
}

/** What's selected on the map, in words. */
export function selectionText(area: AreaDetail, s: BuilderState): string | null {
  if (s.streetId) return area.scene.streets.find((x) => x.id === s.streetId)?.name ?? null;
  if (s.buildingId) {
    const b = area.scene.buildings.find((x) => x.id === s.buildingId);
    return b ? `Building · ${Math.round(b.heightM)} m tall · ${b.footprintM2.toLocaleString()} m²` : null;
  }
  if (s.points.length) return `${s.points.length} point${s.points.length === 1 ? '' : 's'} placed`;
  return null;
}

/** Map taps for the current change type (shared by the inline and side-by-side layouts). */
export function mapHandlers(s: BuilderState, set: (patch: Partial<BuilderState>) => void) {
  const pick = s.type ? OP_PICK[s.type] : null;
  return {
    pick,
    onStreet: (streetId: string) => set({ streetId }),
    onBuilding: (buildingId: string) => set({ buildingId }),
    onMapPress: (p: LatLng) => {
      if (pick === 'point') set({ points: [p] });
      else if (pick === 'polygon' || pick === 'line_or_polygon') set({ points: [...s.points, p] });
    },
  };
}

/**
 * Steps 1–3 of a new request: what kind of change, where (map), options. The map is drawn
 * inline on phones; on desktop the screen shows it big beside this panel (`mapInline={false}`).
 */
export function ChangeBuilder({ area, value: s, onChange, mapInline = true }: {
  area: AreaDetail;
  value: BuilderState;
  onChange: (next: BuilderState) => void;
  mapInline?: boolean;
}) {
  const t = useTheme();
  const set = (patch: Partial<BuilderState>) => onChange({ ...s, ...patch });
  const { pick, onStreet, onBuilding, onMapPress } = mapHandlers(s, set);
  const chooseType = (type: OpType) => onChange({ ...s, type, streetId: null, buildingId: null, points: [] });
  const picked = selectionText(area, s);
  const sides = s.type === 'add_bike_lane' || s.type === 'add_bus_lane' || s.type === 'remove_parking';

  return (
    <View style={{ gap: 18 }}>
      <View style={{ gap: 10 }}>
        <Label>1 · WHAT KIND OF CHANGE</Label>
        <View style={styles.grid}>
          {OP_TYPES.map((k) => (
            <Chip key={k} label={TYPE_LABEL[k]} active={s.type === k} onPress={() => chooseType(k)} style={styles.cell} />
          ))}
        </View>
      </View>

      {s.type && (
        <View style={{ gap: 10 }}>
          <Label>{pickLabel(pick, s.treeShape)}</Label>
          {s.type === 'plant_trees' && (
            <Segmented
              options={[['line', 'Along a line'], ['area', 'In an area']]}
              value={s.treeShape}
              onChange={(v) => set({ treeShape: v as 'line' | 'area', points: [] })}
            />
          )}
          {mapInline ? (
            <View>
              <PickerMap area={area} pick={pick} treeShape={s.treeShape} streetId={s.streetId} buildingId={s.buildingId} points={s.points}
                onStreet={onStreet} onBuilding={onBuilding} onMapPress={onMapPress} height={220} />
              {picked && (
                <View style={[styles.pickedTag, { backgroundColor: t.bg + 'cc' }]} pointerEvents="none">
                  <Text style={{ color: t.accent, fontFamily: fonts.bodySemi, fontSize: 12 }}>{picked}</Text>
                </View>
              )}
            </View>
          ) : (
            <View style={[styles.pickedRow, { backgroundColor: t.inner, borderColor: t.border }]}>
              <Text style={{ color: picked ? t.text : t.muted, fontFamily: fonts.body, fontSize: 15, flex: 1 }}>{picked ?? 'Nothing picked yet'}</Text>
              <Muted>Use the map on the left</Muted>
            </View>
          )}
          {(pick === 'polygon' || pick === 'line_or_polygon') && s.points.length > 0 && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button small kind="secondary" title="Undo point" onPress={() => set({ points: s.points.slice(0, -1) })} />
              <Button small kind="secondary" title="Clear" onPress={() => set({ points: [] })} />
            </View>
          )}
        </View>
      )}

      {s.type && (
        <View style={{ gap: 10 }}>
          <Label>3 · OPTIONS</Label>
          {sides && (
            <Segmented options={[['both', 'Both sides'], ['one', 'One side']]} value={s.bothSides ? 'both' : 'one'} onChange={(v) => set({ bothSides: v === 'both' })} />
          )}
          {s.type === 'add_bike_lane' && <Toggle label="Protected (buffer + posts)" value={s.isProtected} onChange={(isProtected) => set({ isProtected })} />}
          {s.type === 'add_crosswalk' && <Toggle label="Raised (slows cars)" value={s.raised} onChange={(raised) => set({ raised })} />}
          {s.type === 'widen_sidewalk' && <Stepper label="Extra width per side" value={s.meters} onChange={(meters) => set({ meters })} min={0.5} max={4} step={0.5} suffix=" m" />}
          {s.type === 'plant_trees' && <Stepper label="Trees" value={s.count} onChange={(count) => set({ count })} min={1} max={200} step={5} />}
          {s.type === 'replace_building' && (
            <>
              <Stepper label="Floors" value={s.floors} onChange={(floors) => set({ floors })} min={1} max={40} />
              <View style={styles.grid}>
                {BuildingUse.options.map((u) => (
                  <Chip key={u} label={u.replace(/_/g, ' ')} active={s.use === u} onPress={() => set({ use: u })} style={styles.useCell} />
                ))}
              </View>
              {s.use === 'affordable_housing' && (
                <Stepper label={s.units === 0 ? 'Homes (auto from floor area)' : 'Homes'} value={s.units} onChange={(units) => set({ units })} min={0} max={1000} step={10} />
              )}
            </>
          )}
          {s.type === 'add_park' && (
            <TextInput
              placeholder="Park name (optional)"
              placeholderTextColor={t.muted}
              value={s.name}
              onChangeText={(name) => set({ name })}
              style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.inner }]}
            />
          )}
        </View>
      )}
    </View>
  );
}

function Segmented({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={[styles.segmented, { backgroundColor: t.inner, borderColor: t.border }]}>
      {options.map(([v, label]) => {
        const on = v === value;
        return (
          <Pressable key={v} onPress={() => onChange(v)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.segment, on && { backgroundColor: t.accent }]}>
            <Text style={{ color: on ? t.accentText : t.soft, fontFamily: fonts.bodySemi, fontSize: 14 }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <View style={styles.toggleRow}>
      <Text style={{ color: t.text, fontFamily: fonts.body, fontSize: 15, flex: 1 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: t.accent, false: t.borderStrong }} thumbColor={value ? t.accentText : t.muted} />
    </View>
  );
}

function Stepper({ label, value, onChange, min, max, step = 1, suffix = '' }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string;
}) {
  const t = useTheme();
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 100) / 100));
  return (
    <View style={styles.toggleRow}>
      <Text style={{ color: t.text, fontFamily: fonts.body, fontSize: 15, flex: 1 }}>{label}</Text>
      <Button small kind="secondary" title="−" onPress={() => onChange(clamp(value - step))} />
      <Mono size={16} style={{ minWidth: 64, textAlign: 'center' }}>{value}{suffix}</Mono>
      <Button small kind="secondary" title="+" onPress={() => onChange(clamp(value + step))} />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { flexBasis: '22%', flexGrow: 1, minHeight: 60 },
  useCell: { flexBasis: '30%', flexGrow: 1, minHeight: 44 },
  pickedTag: { position: 'absolute', left: 12, bottom: 12, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  segmented: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 12, borderWidth: 1 },
  segment: { flex: 1, height: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15 },
});
