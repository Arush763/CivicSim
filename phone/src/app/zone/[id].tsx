import { zoneBbox, type AreaDetail, type Draft } from '@mamdani/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Platform, RefreshControl, ScrollView, Share, View } from 'react-native';
import MapView, { Polygon } from 'react-native-maps';
import { Icon } from '@/components/Icon';
import { RequestRow } from '@/components/RequestRow';
import { BottomBar, Button, H2, Header, IconButton, MapIn, Notice, Press, Progress, Screen, Section, Shimmer, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fetchZoneRequests, netScore, useApi, useAsync, useVoting } from '@/lib/data';
import { costRange, describeZone, ISSUE_LABELS, zoneCoords, zoneStats } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { alpha } from '@/lib/theme';

type Sort = 'top' | 'new';

export default function ZoneScreen() {
  return (
    <Screen>
      <ZoneScreenContent />
    </Screen>
  );
}

function ZoneScreenContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors: c } = useSettings();
  const api = useApi();
  const { devMode } = useAuth();
  const area = useAsync(() => api.area(id), [api, id]);
  const reqs = useAsync(() => fetchZoneRequests(id), [id]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [sort, setSort] = useState<Sort>('top');
  const voting = useVoting(reqs.data);

  useFocusEffect(
    useCallback(() => {
      void reqs.refresh();
      api.drafts(id).then(setDrafts).catch(() => setDrafts([]));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, id]),
  );

  const rows = useMemo(() => {
    const list = [...(reqs.data ?? [])];
    return sort === 'top' ? list.sort((a, b) => netScore(b) - netScore(a)) : list.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }, [reqs.data, sort]);

  const a = area.data;
  const name = a?.name ?? reqs.data?.[0]?.area_name ?? 'Zone';
  const bbox = zoneBbox(id) ?? a?.bbox ?? null;
  const share = () =>
    Share.share({ message: `${name} (${zoneCoords(id)}) on CivicSim: civicsim://zone/${id}` }).catch(() => {});

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={name} subtitle={zoneCoords(id)} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        right={<IconButton icon="share" label="Share zone" onPress={share} size={48} />} />
      <ScrollView contentContainerStyle={{ paddingBottom: 120, gap: 8 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => { void area.refresh(); void reqs.refresh(); }} />}>
        {bbox && <ZonePreview bbox={bbox} />}

        {area.error ? (
          <Section>
            <Notice kind="error">{area.error.message}</Notice>
            <Button title="Try again" kind="outline" height={44} onPress={() => area.refresh()} />
          </Section>
        ) : !a ? (
          <Section>
            <H2>About this zone</H2>
            <T size={13} color={c.text2}>Loading this zone’s streets and buildings. The first time a zone is opened this can take up to 40 seconds.</T>
            <Shimmer style={{ height: 60 }} />
          </Section>
        ) : (
          <>
            <Section delay={120}>
              <H2>About this zone</H2>
              <T size={14} color={c.text3} style={{ lineHeight: 21 }}>{describeZone(a)}</T>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[
                  [String(zoneStats(a).buildings), 'Buildings'],
                  [String(zoneStats(a).streets), 'Streets'],
                  [`${zoneStats(a).avgHeight} m`, 'Avg height'],
                ].map(([n, label]) => (
                  <View key={label} style={{ flex: 1, backgroundColor: c.inset, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, gap: 2 }}>
                    <T size={18} weight="medium">{n}</T>
                    <T size={12} color={c.text2}>{label}</T>
                  </View>
                ))}
              </View>
            </Section>
            <Complaints area={a} />
          </>
        )}

        {drafts.length > 0 && (
          <Section delay={240} style={{ paddingHorizontal: 0, paddingBottom: 4 }}>
            <H2 style={{ paddingHorizontal: 16 }}>Your drafts</H2>
            {drafts.map((d) => (
              <Press key={d.id} scaleTo={0.98} onPress={() => router.push({ pathname: '/new/[areaId]', params: { areaId: id, draft: d.id } })} accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.border }}>
                <Icon name="pen" size={18} color={c.text2} />
                <View style={{ flex: 1 }}>
                  <T size={15} weight="medium" numberOfLines={1}>{d.title}</T>
                  <T size={12} color={c.text2}>{d.ops.length} change{d.ops.length === 1 ? '' : 's'} · {costRange(d.cost)} · not submitted</T>
                </View>
                <Icon name="chevron" size={18} color={c.text2} />
              </Press>
            ))}
          </Section>
        )}

        <Section delay={320} style={{ paddingHorizontal: 0, paddingBottom: 4, gap: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 }}>
            <H2>Requests here</H2>
            <Press onPress={() => setSort(sort === 'top' ? 'new' : 'top')} accessibilityRole="button" accessibilityLabel={`Sorted by ${sort === 'top' ? 'most upvoted' : 'newest'}. Change sort.`}
              style={{ height: 36, paddingLeft: 12, paddingRight: 8, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <T size={13} weight="medium" color={c.text3}>{sort === 'top' ? 'Most upvoted' : 'Newest'}</T>
              <Icon name="down" size={16} color={c.text3} />
            </Press>
          </View>
          {reqs.error && <Notice kind="error" style={{ marginHorizontal: 16, marginBottom: 12 }}>{reqs.error.message}</Notice>}
          {!reqs.data && !reqs.error && <Shimmer style={{ height: 64, marginHorizontal: 16, marginBottom: 12 }} />}
          {reqs.data && rows.length === 0 && (
            <T size={14} color={c.text2} style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.border }}>
              No requests here yet. Be the first to suggest a change.
            </T>
          )}
          {rows.map((r) => (
            <RequestRow key={r.id} p={r} my={voting.my(r.id)} score={voting.ups(r) - voting.downs(r)} onUp={() => voting.vote(r.id, 1)} onDown={() => voting.vote(r.id, -1)} />
          ))}
          {devMode && <T size={12} color={c.text2} style={{ padding: 16 }}>Local-only mode: everyone on this server votes as the same test user.</T>}
        </Section>
      </ScrollView>
      <BottomBar>
        <Button title="Request a change" icon="plus" onPress={() => router.push({ pathname: '/new/[areaId]', params: { areaId: id } })} />
      </BottomBar>
    </View>
  );
}

/** The zone on the real map, outlined. */
function ZonePreview({ bbox }: { bbox: [number, number, number, number] }) {
  const { colors: c } = useSettings();
  const [w, s, e, n] = bbox;
  return (
    <MapIn style={{ height: 150, backgroundColor: c.bg }}>
      <MapView
        style={{ flex: 1 }}
        pointerEvents="none"
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        userInterfaceStyle={c.dark ? 'dark' : 'light'}
        initialRegion={{ latitude: (s + n) / 2, longitude: (w + e) / 2, latitudeDelta: (n - s) * 1.15, longitudeDelta: (e - w) * 2.6 }}
      >
        <Polygon
          coordinates={[{ latitude: s, longitude: w }, { latitude: s, longitude: e }, { latitude: n, longitude: e }, { latitude: n, longitude: w }]}
          strokeColor={c.accent}
          strokeWidth={3}
          fillColor={alpha(c.accent, 0.14)}
          lineDashPattern={Platform.OS === 'ios' ? [10, 4] : undefined}
        />
      </MapView>
      <View style={{ position: 'absolute', left: 12, bottom: 12, height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: c.raised, justifyContent: 'center' }}>
        <T size={12} weight="medium" color={c.text3}>200 × 200 m zone</T>
      </View>
    </MapIn>
  );
}

function Complaints({ area }: { area: AreaDetail }) {
  const { colors: c } = useSettings();
  if (area.issuesSource !== 'nyc311') {
    return (
      <Section delay={200}>
        <H2>Complaints</H2>
        <T size={13} color={c.text2}>Complaint data (like New York’s 311) isn’t available for this area yet.</T>
      </Section>
    );
  }
  const sorted = [...area.issues].filter((i) => i.count > 0).sort((x, y) => y.count - x.count);
  const top = sorted.filter((i) => i.category !== 'other').slice(0, 4);
  const rest = sorted.filter((i) => !top.includes(i)).reduce((t, i) => t + i.count, 0);
  const bars = [...top.map((i) => ({ label: ISSUE_LABELS[i.category] ?? i.category, n: i.count, other: false })), ...(rest ? [{ label: 'Other', n: rest, other: true }] : [])];
  const max = Math.max(1, ...bars.map((b) => b.n));
  return (
    <Section delay={200}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <H2>Complaints · last 90 days</H2>
        <T size={12} color={c.text2}>NYC 311</T>
      </View>
      {bars.length === 0 && <T size={13} color={c.text2}>No complaints recorded here in the last 90 days.</T>}
      {bars.map((b, i) => (
        <View key={b.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <T size={13} color={c.text3} style={{ width: 112 }} numberOfLines={1}>{b.label}</T>
          <View style={{ flex: 1 }}>
            <Progress frac={b.n / max} color={b.other ? c.muted : c.accent} delay={350 + i * 110} />
          </View>
          <T size={13} weight="medium" style={{ width: 36, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{b.n}</T>
        </View>
      ))}
    </Section>
  );
}
