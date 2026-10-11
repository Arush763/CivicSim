import { HEAT_COLORS, HEAT_LABELS, HEAT_NOTE, HEAT_ZOOM, heatLevel, zoneBbox, zoneIdAt, zonesInView, type Area, type HeatLevel } from '@mamdani/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ZoneSearch } from '@/components/AppNav';
import { Icon } from '@/components/icons';
import { GRID_ZOOM, PILOT_CAMERA, type Camera, type MapZone } from '@/components/map/types';
import { ZoneMap } from '@/components/map/ZoneMap';
import { Button, H1, Label, Muted, Notice } from '@/components/ui';
import { SERVER_URL } from '@/lib/config';
import { fonts, shadow, useIsWide, useTheme, zoneCode } from '@/lib/theme';
import { areaBbox, useAreas, useZoneRequests, zoneCenter, type ZoneSummary } from '@/lib/zones';

type Ranked = Area & ZoneSummary;

export default function MapScreen() {
  const t = useTheme();
  const wide = useIsWide();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ at?: string; label?: string }>();
  const { areas, error, refresh: refreshAreas } = useAreas();
  const zones = useZoneRequests();
  const [cycle, setCycle] = useState(0);
  const [flyTarget, setFlyTarget] = useState<Camera | null>(null);
  const [hint, setHint] = useState(false);
  const [view, setView] = useState<{ bbox: [number, number, number, number]; zoom: number } | null>(null);
  const zoomedIn = (view?.zoom ?? 0) >= GRID_ZOOM;

  // Pick up requests (and newly opened zones) made elsewhere whenever the map comes back into view.
  useFocusEffect(
    useCallback(() => {
      void zones.refresh();
      refreshAreas();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // A place picked in search arrives as ?at=lng,lat.
  const searched = useMemo<Camera | null>(() => {
    if (!params.at) return null;
    const [lng, lat] = params.at.split(',').map(Number);
    return Number.isFinite(lng) && Number.isFinite(lat) ? { center: [lng, lat], zoom: 17.5, tilt: 45 } : null;
  }, [params.at]);
  const focus = flyTarget ?? searched;

  // A tap can reach both a zone and the map underneath it on phones; open the zone once.
  const lastOpen = useRef({ id: '', at: 0 });
  const open = (id: string) => {
    const now = Date.now();
    if (lastOpen.current.id === id && now - lastOpen.current.at < 1000) return;
    lastOpen.current = { id, at: now };
    router.push({ pathname: '/area/[id]', params: { id } });
  };
  const onMapPress = (lng: number, lat: number) => {
    if (zoomedIn) open(zoneIdAt(lng, lat));
    else setHint(true);
  };

  // Only zones with requests are listed; every other zone is just a square on the map.
  const ranked = useMemo(() => {
    const all: Ranked[] = Object.entries(zones.byZone).flatMap(([id, s]) => {
      const bbox = areaBbox(id, areas);
      return bbox ? [{ id, bbox, name: areas?.find((a) => a.id === id)?.name ?? `Zone ${zoneCode(id)}`, issueTotal: 0, ...s }] : [];
    });
    return {
      waiting: all.filter((z) => z.waiting > 0).sort((a, b) => b.waiting - a.waiting),
      approved: all.filter((z) => z.approved > 0 && z.waiting === 0),
    };
  }, [areas, zones.byZone]);

  // Complaint totals for the heat map, straight from Supabase (every known zone).
  const [heat, setHeat] = useState<{ id: string; name: string; bbox: [number, number, number, number]; issue_total: number }[]>([]);
  useEffect(() => {
    void supabase?.from('areas').select('id,name,bbox,issue_total').gt('issue_total', 0).limit(2000)
      .then(({ data }) => data && setHeat(data as typeof heat));
  }, []);

  // Heat for everything in view, anywhere in the world, once zoomed in (kept as you pan around).
  const [viewHeat, setViewHeat] = useState<Map<string, HeatLevel>>(new Map());
  useEffect(() => {
    if (!view || view.zoom < HEAT_ZOOM || !SERVER_URL) return;
    const t = setTimeout(() => {
      fetch(`${SERVER_URL}/heat?bbox=${view.bbox.map((v) => v.toFixed(5)).join(',')}`)
        .then((r) => r.json() as Promise<{ zones?: { id: string; level: HeatLevel }[] }>)
        .then(({ zones = [] }) => {
          if (!zones.length) return;
          setViewHeat((cur) => {
            const next = new Map(cur);
            for (const z of zones) next.set(z.id, z.level);
            return next;
          });
        })
        .catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [view]);

  // The heat map at any zoom; zoomed in, the worldwide grid around the view; zones with requests always.
  const mapZones = useMemo<MapZone[]>(() => {
    const out = new Map<string, MapZone>();
    const heatOf = new Map<string, HeatLevel>(heat.map((a) => [a.id, heatLevel(a.issue_total)] as const));
    for (const [id, level] of viewHeat) heatOf.set(id, level);
    for (const a of heat) out.set(a.id, { id: a.id, name: a.name, bbox: a.bbox, heat: heatOf.get(a.id) });
    for (const [id, level] of viewHeat) {
      const bbox = zoneBbox(id);
      if (bbox) out.set(id, { id, name: '', bbox, heat: level });
    }
    if (view && zoomedIn) for (const id of zonesInView(view.bbox)) if (!out.has(id)) out.set(id, { id, name: '', bbox: zoneBbox(id)! });
    for (const z of [...ranked.waiting, ...ranked.approved]) {
      out.set(z.id, { id: z.id, name: z.name, bbox: z.bbox, state: z.waiting ? 'waiting' : 'approved', badge: z.waiting || z.approved, heat: heatOf.get(z.id) });
    }
    return [...out.values()];
  }, [view, zoomedIn, ranked, heat, viewHeat]);

  const flyToNextWaiting = () => {
    const list = ranked.waiting;
    if (!list.length) return;
    const z = list[cycle % list.length];
    setFlyTarget({ center: zoneCenter(z.bbox), zoom: 17, tilt: 50 });
    setCycle((c) => c + 1);
  };

  if (!SERVER_URL) {
    return (
      <View style={{ flex: 1, padding: 16, justifyContent: 'center' }}>
        <Notice>Set EXPO_PUBLIC_SERVER_URL in adminpanel/.env to your PC server, then restart Expo.</Notice>
      </View>
    );
  }

  const legend = (
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      <LegendChip color={t.waiting} label="Requests waiting" />
      <LegendChip color={t.approved} label="Approved" />
      {(['high', 'medium', 'low'] as const).map((h) => <LegendChip key={h} color={HEAT_COLORS[h]} label={`${HEAT_LABELS[h]} heat`} />)}
      <Muted>{HEAT_NOTE}</Muted>
    </View>
  );

  const map = (
    <ZoneMap
      style={StyleSheet.absoluteFill}
      zones={mapZones}
      onZonePress={open}
      onMapPress={onMapPress}
      onViewChange={(bbox, zoom) => {
        setView({ bbox, zoom });
        if (zoom >= GRID_ZOOM) setHint(false);
      }}
      initialCamera={wide ? { ...PILOT_CAMERA, zoom: 14.6 } : PILOT_CAMERA}
      focus={focus}
      controls={wide ? { right: 24, bottom: 32 } : { right: 16, bottom: 112 }}
    />
  );

  if (wide) {
    return (
      <View style={{ flex: 1, backgroundColor: t.water }}>
        {map}
        <ScrollView style={[styles.aside, { backgroundColor: t.card }, shadow]} contentContainerStyle={{ padding: 20, gap: 18 }}>
          <View style={{ gap: 6 }}>
            <Label>Anywhere in the world</Label>
            <H1 size={24}>Pick a zone to vote on</H1>
            <Text style={[styles.empty, { color: t.muted }]}>
              {zoomedIn ? 'Click any square on the map to open that zone.' : 'Search for a place or zoom in to see the zones, then click one.'}
            </Text>
          </View>
          {legend}
          {error && <Notice kind="error">Can't load zones: {error.message}</Notice>}
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Requests waiting · {ranked.waiting.length} zone{ranked.waiting.length === 1 ? '' : 's'}</Text>
            {ranked.waiting.length === 0 && <Text style={[styles.empty, { color: t.muted }]}>No requests yet. Open any zone to start one.</Text>}
            {ranked.waiting.slice(0, 6).map((z) => (
              <ZoneRow key={z.id} zone={z} count={z.waiting} caption={`${z.waiting} request${z.waiting === 1 ? '' : 's'} waiting`} onPress={() => open(z.id)} />
            ))}
          </View>
          {ranked.approved.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text style={[styles.sectionTitle, { color: t.text }]}>Recently approved</Text>
              {ranked.approved.slice(0, 4).map((z) => (
                <ZoneRow key={z.id} zone={z} count={z.approved} approved caption="Approved" onPress={() => open(z.id)} />
              ))}
            </View>
          )}
          {hint && <Notice>{zoomedIn ? 'Click any square on the map, then "Request a change in this zone".' : 'Zoom in until the zone squares appear, then click one.'}</Notice>}
          <Button title="Request a change" icon={<Icon name="plus" size={20} color={t.accentText} strokeWidth={2.4} />} onPress={() => setHint(true)} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.water }}>
      {map}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        <ZoneSearch style={{ width: '100%' }} />
        {legend}
      </View>
      {(error || hint) && (
        <View style={{ position: 'absolute', left: 16, right: 16, top: insets.top + 120 }} pointerEvents="none">
          {error ? <Notice kind="error">Can't load zones: {error.message}</Notice> : <Notice>Zoom in until the zone squares appear, then tap one.</Notice>}
        </View>
      )}
      <Pressable onPress={flyToNextWaiting} accessibilityRole="button" style={[styles.waitingCard, { backgroundColor: t.card }, shadow]}>
        <View style={[styles.waitingCount, { backgroundColor: t.waitingTint }]}>
          <Text style={{ color: '#B06000', fontFamily: fonts.bodyBold, fontSize: 16 }}>{ranked.waiting.length}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: t.text, fontFamily: fonts.bodyMedium, fontSize: 15 }}>
            {ranked.waiting.length ? 'Zones with requests waiting' : ranked.approved.length ? 'No requests waiting' : 'No requests yet'}
          </Text>
          <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }}>
            {ranked.waiting.length ? 'Tap to fly to them · tap a zone to vote' : 'Zoom in and tap any square to request a change'}
          </Text>
        </View>
        <Icon name="chevron" size={20} color={t.muted} />
      </Pressable>
    </View>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  const t = useTheme();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.card, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 }, shadow]}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ color: t.soft, fontFamily: fonts.bodyMedium, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function ZoneRow({ zone, count, caption, approved, onPress }: { zone: Area; count: number; caption: string; approved?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="link" style={({ pressed }) => [styles.zoneRow, { borderColor: t.divider, backgroundColor: pressed ? t.raised : t.card }]}>
      <View style={[styles.rowCount, { backgroundColor: approved ? t.approvedTint : t.waitingTint }]}>
        <Text style={{ color: approved ? '#137333' : '#B06000', fontFamily: fonts.bodyBold, fontSize: 14 }}>{count}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: t.text, fontFamily: fonts.bodyMedium, fontSize: 14 }}>{zone.name}</Text>
        <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 12 }}>
          Zone {zoneCode(zone.id)} · {caption}
        </Text>
      </View>
      <Icon name="chevron" size={18} color={t.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 16, gap: 10 },
  waitingCard: { position: 'absolute', left: 16, right: 16, bottom: 16, padding: 14, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  waitingCount: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  aside: { position: 'absolute', left: 24, top: 24, width: 360, maxHeight: '90%', borderRadius: 16 },
  sectionTitle: { fontFamily: fonts.bodyMedium, fontSize: 15 },
  empty: { fontFamily: fonts.body, fontSize: 13 },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  rowCount: { minWidth: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
