import { zoneIdAt } from '@mamdani/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { dur, ease } from '@/lib/motion';
import { FeedCard } from '@/components/FeedCard';
import { Icon } from '@/components/Icon';
import { Button, Notice, Press, Rise, Screen, Shimmer, T, TitleBar } from '@/components/ui';
import { fetchFeed, useVoting, type FeedSort, type Proposal } from '@/lib/data';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNearMe } from '@/lib/location';
import { useSettings } from '@/lib/settings';

const SORTS: { id: FeedSort; label: string }[] = [
  { id: 'hot', label: 'Hot' },
  { id: 'new', label: 'New' },
  { id: 'top', label: 'Top' },
  { id: 'pet', label: 'Petitions' },
];
const TAB_W = 84;

export default function Feed() {
  return (
    <Screen>
      <FeedContent />
    </Screen>
  );
}

function FeedContent() {
  const { colors: c } = useSettings();
  const nearMe = useNearMe();
  const insets = useSafeAreaInsets();
  const [scope, setScope] = useState<'near' | 'world'>('near');
  const [sort, setSort] = useState<FeedSort>('hot');
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fresh, setFresh] = useState(0);
  const [round, setRound] = useState(0);
  const list = useRef<FlatList<Proposal>>(null);
  const newest = useRef(0);
  const voting = useVoting(rows);

  // Without your location, "Near me" can't work: show everywhere instead.
  const near = scope === 'near' ? nearMe.near : null;
  const waitingForPlace = scope === 'near' && !nearMe.near && nearMe.status === 'locating';
  useEffect(() => {
    if (nearMe.status === 'denied' || nearMe.status === 'unavailable') setScope('world');
  }, [nearMe.status]);

  const load = useCallback(async () => {
    if (waitingForPlace) return;
    try {
      const r = await fetchFeed({ sort, near });
      setRows(r);
      newest.current = Math.max(0, ...r.map((p) => Date.parse(p.created_at)));
      setFresh(0);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [sort, near?.lng, near?.lat, waitingForPlace]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Every half minute, check for requests newer than the newest shown.
  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetchFeed({ sort: 'new', near }).catch(() => null);
      if (r && newest.current) setFresh(r.filter((p) => Date.parse(p.created_at) > newest.current).length);
    }, 30_000);
    return () => clearInterval(t);
  }, [near?.lng, near?.lat]); // eslint-disable-line react-hooks/exhaustive-deps

  const ind = useSharedValue(0);
  useEffect(() => {
    ind.value = withTiming(SORTS.findIndex((s) => s.id === sort) * TAB_W, { duration: dur.seg, easing: ease.seg });
  }, [sort, ind]);
  const indStyle = useAnimatedStyle(() => ({ transform: [{ translateX: ind.value }] }));

  const pickSort = (s: FeedSort) => {
    if (s === sort) return;
    setRows(null);
    setRound((n) => n + 1);
    setSort(s);
  };

  const newRequest = () => {
    if (nearMe.near) router.push({ pathname: '/new/[areaId]', params: { areaId: zoneIdAt(nearMe.near.lng, nearMe.near.lat) } });
    else router.navigate('/');
  };
  const placeLabel = scope === 'world' ? 'Worldwide' : nearMe.label ?? 'Near me';

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TitleBar
        title="Feed"
        right={
          <>
            <Press onPress={() => { setRows(null); setScope(scope === 'near' ? 'world' : 'near'); if (scope === 'world' && !nearMe.near) void nearMe.locate(); }}
              accessibilityRole="button" accessibilityLabel={`Showing ${placeLabel}. Switch to ${scope === 'near' ? 'worldwide' : 'near me'}.`}
              style={{ height: 36, paddingLeft: 12, paddingRight: 10, borderRadius: 18, borderWidth: 1, borderColor: c.line, flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 190 }}>
              <Icon name="pin" size={16} color={c.text2} />
              <T size={13} weight="medium" color={c.text3} numberOfLines={1} style={{ flexShrink: 1 }}>{placeLabel}</T>
              <Icon name="down" size={16} color={c.text2} />
            </Press>
            <Press onPress={newRequest} accessibilityRole="button" accessibilityLabel="Request a change"
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.accentBg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="plus" size={22} color={c.accentFg} width={2.2} />
            </Press>
          </>
        }
      >
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', marginHorizontal: -8 }}>
          <Animated.View style={[{ position: 'absolute', left: 18, bottom: 0, width: 48, height: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: c.accent }, indStyle]} />
          {SORTS.map((s) => (
            <Pressable key={s.id} onPress={() => pickSort(s.id)} accessibilityRole="tab" accessibilityState={{ selected: s.id === sort }}
              style={{ width: TAB_W, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <T size={14} weight="medium" color={s.id === sort ? c.link : c.text2}>{s.label}</T>
            </Pressable>
          ))}
        </View>
      </TitleBar>

      <FlatList
        ref={list}
        data={rows ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        renderItem={({ item, index }) => (
          <Rise key={`${item.id}-${round}`} delay={120 + Math.min(index, 6) * 80}>
            <FeedCard p={item} my={voting.my(item.id)} score={voting.ups(item) - voting.downs(item)} onUp={() => voting.vote(item.id, 1)} onDown={() => voting.vote(item.id, -1)} />
          </Rise>
        )}
        ListHeaderComponent={error ? <Notice kind="error">{error}</Notice> : null}
        ListEmptyComponent={
          !rows && !error ? (
            <View style={{ gap: 10 }}>
              {[0, 1, 2].map((i) => <Shimmer key={i} style={{ height: 120, borderRadius: 16 }} />)}
            </View>
          ) : rows ? (
            <View style={{ alignItems: 'center', gap: 12, paddingTop: 48, paddingHorizontal: 24 }}>
              <Icon name="feed" size={36} color={c.text2} />
              <T size={15} color={c.text2} style={{ textAlign: 'center' }}>
                {sort === 'pet' ? 'No petitions here yet.' : scope === 'near' ? `No requests near ${nearMe.label ?? 'you'} yet.` : 'No requests yet.'}
              </T>
              {scope === 'near' ? (
                <Button title="See requests worldwide" kind="outline" height={44} onPress={() => { setRows(null); setScope('world'); }} />
              ) : (
                <Button title="Request a change" icon="plus" height={44} onPress={newRequest} />
              )}
            </View>
          ) : null
        }
      />

      {fresh > 0 && (
        <Rise from={-16} style={{ position: 'absolute', left: 0, right: 0, top: insets.top + 112, alignItems: 'center' }} pointerEvents="box-none">
          <Press onPress={() => { setRows(null); setRound((n) => n + 1); setSort('new'); list.current?.scrollToOffset({ offset: 0 }); if (sort === 'new') void load(); }} accessibilityRole="button"
            style={{ height: 36, paddingLeft: 12, paddingRight: 16, borderRadius: 18, backgroundColor: c.primary, flexDirection: 'row', alignItems: 'center', gap: 6, shadowColor: c.primary, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}>
            <Icon name="arrowUp" size={16} color={c.onPrimary} width={2.4} />
            <T size={13} weight="medium" color={c.onPrimary}>{fresh} new request{fresh === 1 ? '' : 's'}</T>
          </Press>
        </Rise>
      )}
    </View>
  );
}
