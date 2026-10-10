import { router, type Tabs } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PILOT_CAMERA } from './map/types';
import { placeLocation, searchPlaces, type PlaceHit } from '@/lib/places';
import { fonts, shadow, useIsWide, useTheme, zoneCode } from '@/lib/theme';
import { useAreas } from '@/lib/zones';
import { Icon, type IconName } from './icons';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Map', icon: 'map' },
  proposals: { label: 'Requests', icon: 'requests' },
  petitions: { label: 'Petitions', icon: 'petitions' },
  leaderboard: { label: 'Ranks', icon: 'ranks' },
  account: { label: 'You', icon: 'you' },
};

export function Logo({ size = 24 }: { size?: number }) {
  const t = useTheme();
  return (
    <Text style={{ fontFamily: fonts.display, fontSize: size, letterSpacing: -0.3, color: t.text }}>
      Mamdani<Text style={{ color: t.accent }}>.</Text>
    </Text>
  );
}

/** Bottom tab bar on phones, top navigation bar on wide screens (from the design canvas). */
export function AppNav({ state, navigation }: TabBarProps) {
  const t = useTheme();
  const wide = useIsWide();
  const insets = useSafeAreaInsets();
  const go = (name: string) => navigation.navigate(name as never);
  const current = state.routes[state.index]?.name;

  if (wide) return <TopBar current={current} onGo={go} routes={state.routes.map((r) => r.name)} />;

  return (
    <View style={[styles.bottom, { backgroundColor: t.nav, borderTopColor: t.divider, paddingBottom: Math.max(8, insets.bottom) }]}>
      {state.routes
        .filter((r) => TABS[r.name])
        .map((r) => {
          const active = r.name === current;
          const c = active ? t.accent : t.muted;
          return (
            <Pressable
              key={r.key}
              onPress={() => go(r.name)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={styles.bottomItem}
            >
              <Icon name={TABS[r.name].icon} color={c} />
              <Text style={{ color: c, fontFamily: active ? fonts.bodySemi : fonts.body, fontSize: 11 }}>{TABS[r.name].label}</Text>
            </Pressable>
          );
        })}
    </View>
  );
}

const TOP_ROUTES = ['index', 'proposals', 'petitions', 'leaderboard'];

/**
 * Desktop navigation bar. Inside the tabs it switches tabs; on other screens (zone, request,
 * new request) it navigates back into the tabs.
 */
export function TopBar({ current, onGo, routes = TOP_ROUTES }: { current?: string; onGo?: (name: string) => void; routes?: string[] }) {
  const t = useTheme();
  const go = onGo ?? ((name: string) => router.navigate(name === 'index' ? '/' : (`/${name}` as never)));
  return (
    <View style={[styles.top, { backgroundColor: t.bg, borderBottomColor: t.divider }]}>
      <Pressable onPress={() => go('index')} accessibilityRole="link" accessibilityLabel="Mamdani, map">
        <Logo />
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {routes
          .filter((name) => name !== 'account' && TABS[name])
          .map((name) => {
            const active = name === current;
            return (
              <Pressable
                key={name}
                onPress={() => go(name)}
                accessibilityRole="link"
                accessibilityState={{ selected: active }}
                style={[styles.topLink, active && { backgroundColor: t.forest }]}
              >
                <Text style={{ color: active ? t.accent : t.soft, fontFamily: active ? fonts.bodySemi : fonts.bodyMedium, fontSize: 14 }}>
                  {TABS[name].label}
                </Text>
              </Pressable>
            );
          })}
      </View>
      <View style={{ flex: 1 }} />
      <ZoneSearch />
      <Pressable
        onPress={() => go('account')}
        accessibilityRole="button"
        accessibilityLabel="Your profile"
        style={[styles.profile, { borderColor: current === 'account' ? t.accent : t.border, backgroundColor: t.card }]}
      >
        <Icon name="you" size={20} color={current === 'account' ? t.accent : t.text} />
      </Pressable>
    </View>
  );
}

/**
 * Search zones (by street name) and real places (Google Places). Picking a zone opens it;
 * picking a place flies the map there.
 */
export function ZoneSearch({ style }: { style?: object }) {
  const t = useTheme();
  const { areas } = useAreas();
  const [q, setQ] = useState('');
  const [places, setPlaces] = useState<PlaceHit[]>([]);
  const query = q.trim().toLowerCase();
  const zones = query.length >= 2 && areas ? areas.filter((z) => z.name.toLowerCase().includes(query)).slice(0, 4) : [];

  useEffect(() => {
    if (query.length < 2) return setPlaces([]);
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchPlaces(q, PILOT_CAMERA.center).then((p) => !cancelled && setPlaces(p));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, query.length]);

  const openZone = (id: string) => {
    setQ('');
    router.push({ pathname: '/area/[id]', params: { id } });
  };
  const openPlace = async (p: PlaceHit) => {
    setQ('');
    const at = await placeLocation(p.id);
    if (at) router.navigate({ pathname: '/', params: { at: `${at[0]},${at[1]}`, label: p.title } });
  };
  const first = () => (zones[0] ? openZone(zones[0].id) : places[0] && void openPlace(places[0]));

  return (
    <View style={[{ width: 340, zIndex: 10 }, style]}>
      <View style={[styles.search, { borderColor: t.border, backgroundColor: t.page }]}>
        <Icon name="search" size={18} color={t.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          onSubmitEditing={first}
          placeholder="Search a street, place or zone"
          placeholderTextColor={t.muted}
          accessibilityLabel="Search streets, places or zones"
          style={{ flex: 1, color: t.text, fontFamily: fonts.body, fontSize: 15, paddingVertical: 8, outlineStyle: 'none' } as object}
        />
      </View>
      {(zones.length > 0 || places.length > 0) && (
        <View style={[styles.results, { backgroundColor: t.card, borderColor: t.border }, shadow]}>
          {zones.map((z) => (
            <Pressable key={z.id} onPress={() => openZone(z.id)} style={({ pressed }) => [styles.result, pressed && { backgroundColor: t.raised }]}>
              <Icon name="map" size={18} color={t.accent} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontFamily: fonts.bodyMedium, fontSize: 14 }}>{z.name}</Text>
                <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 12 }}>Zone {zoneCode(z.id)}</Text>
              </View>
            </Pressable>
          ))}
          {places.map((p) => (
            <Pressable key={p.id} onPress={() => void openPlace(p)} style={({ pressed }) => [styles.result, pressed && { backgroundColor: t.raised }]}>
              <Icon name="locate" size={18} color={t.muted} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontFamily: fonts.bodyMedium, fontSize: 14 }}>{p.title}</Text>
                {!!p.subtitle && <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 12 }} numberOfLines={1}>{p.subtitle}</Text>}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { height: 64, paddingHorizontal: 24, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 32, zIndex: 10 },
  topLink: { height: 40, paddingHorizontal: 16, borderRadius: 20, justifyContent: 'center' },
  profile: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  bottom: { borderTopWidth: 1, flexDirection: 'row', paddingTop: 10 },
  bottomItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 48 },
  search: { height: 44, borderRadius: 22, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 },
  results: { position: 'absolute', top: 50, left: 0, right: 0, borderWidth: 1, borderRadius: 12, paddingVertical: 4, overflow: 'hidden' },
  result: { paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
