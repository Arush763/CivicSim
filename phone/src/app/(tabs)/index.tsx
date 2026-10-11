import { zoneBbox, zoneIdAt, zonesInView } from '@mamdani/shared';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { dur, ease } from '@/lib/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Compass, Icon } from '@/components/Icon';
import { Avatar, IconButton, MapIn, Pill, Pop, Press, Rise, Screen, shadow, T } from '@/components/ui';
import { GRID_ZOOM, PILOT_CAMERA, ZoneMap, type MapZone, type ZoneMapHandle } from '@/components/ZoneMap';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { netScore } from '@/lib/data';
import { zoneCoords } from '@/lib/format';
import { useNearMe } from '@/lib/location';
import { useMe } from '@/lib/me';
import { placeLocation, searchPlaces, type PlaceHit } from '@/lib/places';
import { useSettings } from '@/lib/settings';
import { fonts } from '@/lib/theme';
import { isWaiting, useZoneRequests } from '@/lib/zones';

type Filter = 'all' | 'wait' | 'ok' | 'mine';

export default function MapScreen() {
  return (
    <Screen>
      <MapScreenContent />
    </Screen>
  );
}

function MapScreenContent() {
  const { colors: c, quality } = useSettings();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const { me } = useMe();
  const nearMe = useNearMe();
  const { requests, byZone, names } = useZoneRequests();
  const map = useRef<ZoneMapHandle>(null);
  const [view, setView] = useState<{ bbox: [number, number, number, number]; zoom: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [tilt, setTilt] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [showMe, setShowMe] = useState(false);
  const moved = useRef(false);

  // Open where you are, once we know (unless you've already moved the map).
  const start = useRef(nearMe.near ? { center: [nearMe.near.lng, nearMe.near.lat] as [number, number], zoom: 16.2 } : PILOT_CAMERA).current;
  useEffect(() => {
    if (nearMe.near && !moved.current) {
      map.current?.flyTo({ center: [nearMe.near.lng, nearMe.near.lat], zoom: 16.2 }, 900);
      setShowMe(true);
    }
  }, [nearMe.near]);

  // Place search (Google Places), after a short pause in typing.
  useEffect(() => {
    if (query.trim().length < 2) return setHits([]);
    const t = setTimeout(() => {
      const b = view?.bbox;
      const center: [number, number] = b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : start.center;
      searchPlaces(query, center).then(setHits).catch(() => setHits([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query, view, start]);

  const matches = (p: (typeof requests)[number]) =>
    filter === 'all' || (filter === 'wait' && isWaiting(p)) || (filter === 'ok' && p.status === 'accepted') || (filter === 'mine' && p.author_id === userId);

  const zones = useMemo<MapZone[]>(() => {
    const out = new Map<string, MapZone>();
    // The grid, when zoomed in far enough to pick a zone.
    if (view && view.zoom >= GRID_ZOOM) {
      for (const id of zonesInView(view.bbox, 400)) {
        const bbox = zoneBbox(id);
        if (bbox) out.set(id, { id, bbox });
      }
    }
    // Zones with requests, at any zoom: orange while any wait, green once approved.
    const counts = new Map<string, { n: number; waiting: boolean }>();
    for (const r of requests) {
      if (!matches(r)) continue;
      const k = counts.get(r.area_id) ?? { n: 0, waiting: false };
      counts.set(r.area_id, { n: k.n + 1, waiting: k.waiting || isWaiting(r) });
    }
    for (const [id, k] of counts) {
      const bbox = zoneBbox(id);
      if (bbox) out.set(id, { id, bbox, state: k.waiting ? 'waiting' : 'approved', badge: k.n });
    }
    if (selected) {
      const bbox = zoneBbox(selected);
      if (bbox) out.set(selected, { id: selected, bbox, state: 'selected', badge: byZone[selected]?.total || undefined });
    }
    return [...out.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, requests, filter, selected, userId, byZone]);

  const waitingN = requests.filter(isWaiting).length;
  const okN = requests.filter((r) => r.status === 'accepted').length;
  const chips: { id: Filter; label: string; dot?: string }[] = [
    { id: 'all', label: 'All zones' },
    { id: 'wait', label: `Waiting · ${waitingN}`, dot: c.waitDot },
    { id: 'ok', label: `Approved · ${okN}`, dot: c.okDot },
    { id: 'mine', label: 'Mine' },
  ];

  const openZoneAt = (lng: number, lat: number) => {
    Keyboard.dismiss();
    setHits([]);
    if (!view || view.zoom < GRID_ZOOM) {
      // Zoomed out: move in first, so the zone squares can be seen and picked.
      map.current?.flyTo({ center: [lng, lat], zoom: GRID_ZOOM + 1, tilt: tilt ? 45 : 0 });
      return;
    }
    setSelected(zoneIdAt(lng, lat));
  };

  const locate = async () => {
    const here = nearMe.near ?? (await nearMe.locate());
    if (!here) return;
    setShowMe(true);
    map.current?.flyTo({ center: [here.lng, here.lat], zoom: 17, tilt: tilt ? 45 : 0 });
  };

  const goToPlace = async (h: PlaceHit) => {
    Keyboard.dismiss();
    setQuery(h.title);
    setHits([]);
    const at = await placeLocation(h.id).catch(() => null);
    if (at) {
      map.current?.flyTo({ center: at, zoom: 17, tilt: tilt ? 45 : 0 });
      setSelected(zoneIdAt(at[0], at[1]));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <MapIn style={{ flex: 1 }}>
      <ZoneMap
        ref={map}
        style={{ flex: 1 }}
        zones={zones}
        initialCamera={start}
        buildings={quality >= 1}
        showsUser={showMe}
        onZonePress={(id) => setSelected(id)}
        onMapPress={openZoneAt}
        onViewChange={(bbox, zoom) => {
          moved.current = true;
          setView({ bbox, zoom });
        }}
      />
      </MapIn>

      {/* Search */}
      <Rise from={-16} delay={80} style={{ position: 'absolute', left: 16, right: 16, top: insets.top + 8 }}>
        <Animated.View style={[{ height: 48, borderRadius: 24, backgroundColor: c.raised, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 6 }, shadow(c)]}>
          <Icon name="search" size={20} color={c.text2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search a street or place"
            placeholderTextColor={c.text2}
            accessibilityLabel="Search a street or place"
            returnKeyType="search"
            style={{ flex: 1, height: 44, fontSize: 16, fontFamily: fonts.regular, color: c.text }}
          />
          {query ? (
            <IconButton icon="close" label="Clear search" size={36} iconSize={18} onPress={() => { setQuery(''); setHits([]); }} />
          ) : (
            <Press onPress={() => router.push('/ranks')} accessibilityRole="button" accessibilityLabel="Your profile and rank">
              <Avatar name={me?.username ?? 'Me'} size={36} />
            </Press>
          )}
        </Animated.View>
        {hits.length > 0 && (
          <View style={[{ marginTop: 8, borderRadius: 16, backgroundColor: c.raised, overflow: 'hidden' }, shadow(c)]}>
            {hits.map((h, i) => (
              <Pressable key={h.id} onPress={() => goToPlace(h)} accessibilityRole="button"
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 56, borderTopWidth: i ? 1 : 0, borderTopColor: c.border, backgroundColor: pressed ? c.inset : 'transparent' })}>
                <Icon name="pin" size={20} color={c.text2} />
                <View style={{ flex: 1, paddingVertical: 8 }}>
                  <T size={15} numberOfLines={1}>{h.title}</T>
                  {h.subtitle ? <T size={12} color={c.text2} numberOfLines={1}>{h.subtitle}</T> : null}
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </Rise>

      {/* Filters */}
      {hits.length === 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ position: 'absolute', left: 0, right: 0, top: insets.top + 66 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {chips.map((ch, i) => {
            const on = ch.id === filter;
            return (
              <Rise key={ch.id} delay={160 + i * 70}>
              <Press onPress={() => setFilter(ch.id)} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={[{ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: on ? c.accentBg : c.raised, flexDirection: 'row', alignItems: 'center', gap: 8 }, shadow(c)]}>
                {ch.dot && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ch.dot }} />}
                <T size={14} weight="medium" color={on ? c.accentFg : c.text3}>{ch.label}</T>
              </Press>
              </Rise>
            );
          })}
        </ScrollView>
      )}

      {/* Map buttons */}
      <View style={{ position: 'absolute', right: 16, top: insets.top + 124, gap: 10 }}>
        <Pop delay={380}>
        <Press onPress={() => { setTilt(!tilt); map.current?.setTilt(tilt ? 0 : 45); }} accessibilityRole="button" accessibilityLabel="Toggle 3D tilt" accessibilityState={{ selected: tilt }}
          style={[{ width: 44, height: 44, borderRadius: 22, backgroundColor: tilt ? c.accentBg : c.raised, alignItems: 'center', justifyContent: 'center' }, shadow(c)]}>
          <T size={13} weight="bold" color={tilt ? c.accentFg : c.text3}>{tilt ? '2D' : '3D'}</T>
        </Press>
        </Pop>
        <Pop delay={450}>
        <Press onPress={() => map.current?.north()} accessibilityRole="button" accessibilityLabel="Point map north"
          style={[{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center' }, shadow(c)]}>
          <Compass north={c.danger} south={c.muted} />
        </Press>
        </Pop>
        <Pop delay={520}>
        <Press onPress={locate} accessibilityRole="button" accessibilityLabel="Show my location"
          style={[{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center' }, shadow(c)]}>
          <Icon name="locate" size={20} color={c.link} />
        </Press>
        </Pop>
      </View>

      {view && view.zoom < GRID_ZOOM && !selected && (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 16, alignItems: 'center' }}>
          <View style={{ height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.toast, justifyContent: 'center' }}>
            <T size={13} weight="medium" color={c.onToast}>Zoom in to pick a 200 m zone</T>
          </View>
        </View>
      )}

      <ZoneSheet
        id={selected}
        name={selected ? byZone[selected]?.name ?? names.get(selected) ?? null : null}
        summary={selected ? byZone[selected] : undefined}
        onClose={() => setSelected(null)}
      />
    </View>
  );
}

/** The selected zone, in a sheet over the bottom of the map. */
function ZoneSheet({ id, name, summary, onClose }: { id: string | null; name: string | null; summary?: ReturnType<typeof useZoneRequests>['byZone'][string]; onClose: () => void }) {
  const { colors: c } = useSettings();
  const y = useSharedValue(400);
  const [shown, setShown] = useState(id);
  useEffect(() => {
    if (id) {
      setShown(id);
      y.value = withTiming(0, { duration: dur.sheet, easing: ease.out });
    } else {
      y.value = withTiming(400, { duration: 300, easing: ease.out });
    }
  }, [id, y]);
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  // A zone nobody has asked about yet: load it (name from its streets) in the background. This
  // also gets the zone page ready, since the first load fetches its map data.
  const [loadedName, setLoadedName] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!shown || name) return;
    let cancelled = false;
    api(async () => null).area(shown).then((a) => !cancelled && setLoadedName({ id: a.id, name: a.name })).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [shown, name]);
  if (!shown) return null;
  const top = summary?.top ?? null;
  const title = name ?? (loadedName?.id === shown ? loadedName.name : null);

  return (
    <Animated.View
      accessibilityLabel="Selected zone"
      style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8, paddingHorizontal: 16, paddingBottom: 16, gap: 12, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 12 }, anim]}
    >
      <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.handle, alignSelf: 'center' }} />
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T size={20} weight="medium" numberOfLines={1} accessibilityRole="header">{title ?? 'Zone'}</T>
          <T size={13} color={c.text2}>{zoneCoords(shown)} · 200 m zone</T>
        </View>
        <IconButton icon="close" label="Close zone" onPress={onClose} iconSize={20} color={c.text2} style={{ marginTop: -8, marginRight: -10 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {summary?.waiting ? <Pill label={`${summary.waiting} waiting`} bg={c.waitBg} fg={c.waitFg} dot={c.waitDot} height={28} /> : null}
        {summary?.approved ? <Pill label={`${summary.approved} approved`} bg={c.okBg} fg={c.okFg} dot={c.okDot} height={28} /> : null}
        {!summary?.total && <Pill label="No requests yet" bg={c.chip} fg={c.text3} height={28} />}
      </View>
      {top && (
        <Press onPress={() => router.push({ pathname: '/request/[id]', params: { id: top.id } })} accessibilityRole="button" scaleTo={0.98}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: c.line, borderRadius: 12, minHeight: 44 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="up" size={14} color={c.link} fill={c.link} width={1.5} />
            <T size={14} weight="bold" color={c.link}>{netScore(top)}</T>
          </View>
          <T size={14} numberOfLines={1} style={{ flex: 1 }}>{top.title}</T>
          <Icon name="chevron" size={18} color={c.text2} />
        </Press>
      )}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Press onPress={() => router.push({ pathname: '/zone/[id]', params: { id: shown } })} accessibilityRole="button"
          style={{ flex: 1, height: 44, borderRadius: 22, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
          <T size={15} weight="medium" color={c.link}>Open zone</T>
        </Press>
        <Press onPress={() => router.push({ pathname: '/new/[areaId]', params: { areaId: shown } })} accessibilityRole="button"
          style={{ flex: 1, height: 44, borderRadius: 22, backgroundColor: c.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name="plus" size={18} color={c.onPrimary} width={2.2} />
          <T size={15} weight="medium" color={c.onPrimary}>Request a change</T>
        </Press>
      </View>
    </Animated.View>
  );
}
