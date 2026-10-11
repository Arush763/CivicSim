import { RANK_TIERS } from '@mamdani/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Icon } from '@/components/Icon';
import { Avatar, Card, H2, Notice, Pill, Pop, Press, Progress, Rise, Screen, Segmented, Shimmer, T, TitleBar } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fetchLeaderboard, fetchMyPosition, fetchMyStats, type BoardScope, type LeaderRow } from '@/lib/data';
import { rankProgress } from '@/lib/format';
import { useNearMe } from '@/lib/location';
import { useMe } from '@/lib/me';
import { useSettings } from '@/lib/settings';
import type { Theme } from '@/lib/theme';

const EARN: [string, string][] = [
  ['Submit a request', '+10'],
  ['Get an upvote on your request', '+2'],
  ['Sign a petition', '+1'],
  ['Your petition reaches its goal', '+50'],
  ['The city approves your request', '+100'],
];

export default function Ranks() {
  return (
    <Screen>
      <RanksContent />
    </Screen>
  );
}

function RanksContent() {
  const { colors: c } = useSettings();
  const { devMode } = useAuth();
  const [tab, setTab] = useState<'mine' | 'board'>('mine');
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TitleBar title="Ranks">
        <Segmented label="Ranks view" value={tab} onChange={setTab} style={{ marginBottom: 12 }}
          options={[{ id: 'mine', label: 'My rank' }, { id: 'board', label: 'Leaderboard' }]} />
      </TitleBar>
      {devMode ? (
        <View style={{ padding: 12 }}>
          <Notice>Points, ranks and the leaderboard need Supabase to be connected.</Notice>
        </View>
      ) : tab === 'mine' ? (
        <MyRank c={c} />
      ) : (
        <Board c={c} />
      )}
    </View>
  );
}

/** Points that count up to the total, as in the design. */
function useCountUp(target: number) {
  const [n, setN] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const t0 = Date.now() + 250;
    const step = () => {
      const t = Math.max(0, Math.min(1, (Date.now() - t0) / 1400));
      setN(Math.round(target * (1 - Math.pow(1 - t, 4))));
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);
  return n;
}

function MyRank({ c }: { c: Theme }) {
  const { me, refresh } = useMe();
  const [stats, setStats] = useState<{ requests: number; upvotes: number; signed: number } | null>(null);
  useFocusEffect(
    useCallback(() => {
      fetchMyStats().then(setStats).catch(() => {});
    }, []),
  );
  const points = useCountUp(me?.points ?? 0);
  if (!me) return <View style={{ padding: 12, gap: 12 }}><Shimmer style={{ height: 220, borderRadius: 20 }} /></View>;
  const prog = rankProgress(me.points);

  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 24 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => { void refresh(); fetchMyStats().then(setStats).catch(() => {}); }} />}>
      <Card delay={80} style={{ gap: 16, paddingVertical: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Avatar name={me.username} size={56} />
          <View style={{ flex: 1, gap: 4 }}>
            <T size={18} weight="medium" numberOfLines={1}>{me.username}</T>
            <Pill label={me.rank.toUpperCase()} bg={c.accentBg} fg={c.accentFg} />
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <T size={28} weight="bold" style={{ lineHeight: 32, fontVariant: ['tabular-nums'] }} accessibilityLabel={`${me.points} points`}>{points}</T>
            <T size={12} color={c.text2}>points</T>
          </View>
        </View>
        {prog.next ? (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T size={13} color={c.text3}><T size={13} weight="medium">{prog.toGo} points</T> to {prog.next.name}</T>
              <T size={13} color={c.text2} style={{ fontVariant: ['tabular-nums'] }}>{me.points} / {prog.next.min}</T>
            </View>
            <View accessibilityRole="progressbar" accessibilityLabel={`Progress to ${prog.next.name}`} accessibilityValue={{ min: prog.cur.min, max: prog.next.min, now: me.points }}>
              <Progress frac={prog.frac} height={10} />
            </View>
          </View>
        ) : (
          <T size={13} color={c.text3}>You’ve reached the top rank.</T>
        )}
        <View accessibilityLabel="Rank ladder" style={{ flexDirection: 'row' }}>
          {RANK_TIERS.map((tier, i) => (
            <Pop key={tier.name} delay={500 + i * 120} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
              {i < prog.idx ? (
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="check" size={14} color={c.dark ? c.onPrimary : '#FFFFFF'} width={3} />
                </View>
              ) : i === prog.idx ? (
                <CurrentDot c={c} />
              ) : (
                <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: c.line, backgroundColor: c.surface }} />
              )}
              <T size={12} weight={i === prog.idx ? 'bold' : 'medium'} color={i === prog.idx ? c.accentFg : c.text3} style={{ textAlign: 'center' }}>{tier.name}</T>
              <T size={11} color={c.text2}>{tier.min}</T>
            </Pop>
          ))}
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[
          [stats?.requests, 'Requests'],
          [stats?.upvotes, 'Upvotes received'],
          [stats?.signed, 'Petitions signed'],
        ].map(([n, label], i) => (
          <Rise key={label as string} delay={160 + i * 70} style={{ flex: 1 }}>
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 12, gap: 2, minHeight: 72 }}>
              <T size={20} weight="medium" style={{ fontVariant: ['tabular-nums'] }}>{n ?? '–'}</T>
              <T size={12} color={c.text2}>{label}</T>
            </View>
          </Rise>
        ))}
      </View>

      <Card delay={300} style={{ paddingBottom: 6, gap: 0 }}>
        <H2 style={{ marginBottom: 6 }}>How to earn points</H2>
        {EARN.map(([label, pts]) => (
          <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, borderTopWidth: 1, borderTopColor: c.border }}>
            <T size={14} style={{ flex: 1 }}>{label}</T>
            <View style={{ minWidth: 48, height: 26, paddingHorizontal: 8, borderRadius: 13, backgroundColor: c.okBg, alignItems: 'center', justifyContent: 'center' }}>
              <T size={13} weight="bold" color={c.okFg}>{pts}</T>
            </View>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

/** Your current rank on the ladder, with a soft pulse. */
function CurrentDot({ c }: { c: Theme }) {
  const s = useSharedValue(0);
  useEffect(() => {
    s.value = withRepeat(withTiming(1, { duration: 2000 }), -1, false);
  }, [s]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.45 * (1 - s.value), transform: [{ scale: 1 + s.value }] }));
  return (
    <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: c.accent }, ring]} />
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.dark ? c.onPrimary : '#FFFFFF' }} />
      </View>
    </View>
  );
}

function Board({ c }: { c: Theme }) {
  const { userId } = useAuth();
  const nearMe = useNearMe();
  const [scope, setScope] = useState<BoardScope>(nearMe.near ? 'near' : 'world');
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [mine, setMine] = useState<LeaderRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetchLeaderboard(scope, nearMe.near);
      setRows(r);
      setError(null);
      // Not in the top 50 worldwide: show where you are underneath.
      if (scope === 'world' && userId && !r.some((x) => x.id === userId)) setMine(await fetchMyPosition(userId));
      else setMine(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [scope, nearMe.near, userId]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const scopes: { id: BoardScope; label: string }[] = [
    { id: 'near', label: nearMe.label ?? 'Near me' },
    { id: 'world', label: 'Worldwide' },
    { id: 'month', label: 'This month' },
  ];
  const medals = [[c.gold, c.goldFg], [c.silver, c.silverFg], [c.bronze, c.bronzeFg]];
  const shown = [...(rows ?? []), ...(mine ? [mine] : [])];

  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 24 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {scopes.map((s) => {
          const on = s.id === scope;
          return (
            <Press key={s.id} onPress={() => { if (!on) { setRows(null); setScope(s.id); } }} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', borderWidth: on ? 0 : 1, borderColor: c.line, backgroundColor: on ? c.accentBg : c.surface, maxWidth: 170 }}>
              <T size={13} weight="medium" color={on ? c.accentFg : c.text3} numberOfLines={1}>{s.label}</T>
            </Press>
          );
        })}
      </View>
      {error && <Notice kind="error">{error}</Notice>}
      {scope === 'near' && !nearMe.near && <Notice>Turn on location to see who’s active near you.</Notice>}
      {!rows && !error ? (
        <Shimmer style={{ height: 300, borderRadius: 20 }} />
      ) : shown.length === 0 ? (
        <Notice>{scope === 'month' ? 'Nobody has earned points this month yet.' : 'Nobody has earned points here yet. Submit a request to be first.'}</Notice>
      ) : (
        <View accessibilityLabel="Leaderboard" style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 20, paddingVertical: 4, overflow: 'hidden' }}>
          {shown.map((p, i) => {
            const me = p.id === userId;
            const top = p.position <= 3 ? medals[p.position - 1] : null;
            return (
              <Rise key={`${scope}-${p.id}`} delay={80 + Math.min(i, 8) * 70}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderTopColor: c.border, backgroundColor: me ? c.meBg : 'transparent' }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: top ? top[0] : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  <T size={13} weight="bold" color={top ? top[1] : c.text2} style={{ fontVariant: ['tabular-nums'] }}>{p.position}</T>
                </View>
                <Avatar name={p.username} size={36} bg={me ? c.primary : c.avBg} fg={me ? c.onPrimary : c.avFg} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <T size={15} weight="medium" numberOfLines={1}>{p.username}{me ? ' (you)' : ''}</T>
                  <T size={12} weight="medium" color={c.ranks[p.rank] ?? c.text2}>{p.rank}</T>
                </View>
                <T size={15} weight="bold" style={{ fontVariant: ['tabular-nums'] }}>{p.points.toLocaleString()}</T>
              </Rise>
            );
          })}
        </View>
      )}
      {scope === 'near' && <T size={12} color={c.text2}>Points earned from requests and petitions within 5 km of you.</T>}
      {scope === 'month' && <T size={12} color={c.text2}>Points earned since the start of this month, everywhere.</T>}
    </ScrollView>
  );
}
