import type { Suggestion } from '@mamdani/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '@/components/AppNav';
import { Icon } from '@/components/icons';
import { RequestCard } from '@/components/requests';
import type { Camera, MapZone } from '@/components/map/types';
import { ZoneMap } from '@/components/map/ZoneMap';
import { Body, Button, Card, H1, H2, IconButton, Label, Muted, Notice, Pill, Row, Stat } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fetchProposals, useApi, useAsync } from '@/lib/data';
import { describeArea } from '@/lib/describe';
import { describeOp } from '@/lib/ops';
import { fonts, ISSUE_LABELS, money, shadow, useIsWide, useTheme, zoneCode } from '@/lib/theme';
import { areaBbox, isWaiting, useAreas, useZoneRequests, zoneCenter } from '@/lib/zones';

/** The panel that opens when a zone is tapped: what's here, what's been requested, and the vote. */
export default function ZonePanel() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const wide = useIsWide();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { userId } = useAuth();
  const { areas } = useAreas();
  const others = useZoneRequests();
  const area = useAsync(() => api.area(id), [api, id]);
  const requests = useAsync(() => fetchProposals({ areaId: id }), [id]);
  const drafts = useAsync(() => (userId ? api.drafts(id) : Promise.resolve([])), [api, id, userId]);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh after coming back from submitting or viewing a request.
  useFocusEffect(
    useCallback(() => {
      void requests.refresh();
      void drafts.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const bbox = areaBbox(id, areas) ?? area.data?.bbox ?? null;
  const list = useMemo(
    () =>
      [...(requests.data ?? [])].sort(
        (a, b) => Number(isWaiting(b)) - Number(isWaiting(a)) || b.confirm_count - b.deny_count - (a.confirm_count - a.deny_count),
      ),
    [requests.data],
  );
  const waiting = list.filter(isWaiting).length;

  // The real map, tilted onto this zone; other zones keep their request colours.
  const camera = useMemo<Camera | null>(() => (bbox ? { center: zoneCenter(bbox), zoom: wide ? 17.4 : 17, tilt: 55, heading: 29 } : null), [bbox?.join(','), wide]);
  const mapZones = useMemo<MapZone[]>(() => {
    const out: MapZone[] = bbox ? [{ id, name: area.data?.name ?? '', bbox, state: 'selected' }] : [];
    for (const [zid, s] of Object.entries(others.byZone)) {
      const b = zid !== id && (s.waiting || s.approved) ? areaBbox(zid, areas) : null;
      if (b) out.push({ id: zid, name: '', bbox: b, state: s.waiting ? 'waiting' : 'approved', badge: s.waiting || s.approved });
    }
    return out;
  }, [bbox?.join(','), id, area.data?.name, others.byZone, areas]);

  const startDraft = async (fromSuggestion?: Suggestion) => {
    if (!area.data) return;
    setCreating(true);
    try {
      const d = await api.createDraft({
        areaId: id,
        title: fromSuggestion?.title ?? `Change around ${area.data.name}`,
        description: fromSuggestion?.rationale ?? '',
        ops: fromSuggestion?.ops ?? [],
        source: fromSuggestion ? 'ai_suggested' : 'human',
      });
      router.push({ pathname: '/draft/[id]', params: { id: d.id } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const suggest = async () => {
    setSuggesting(true);
    setError(null);
    try {
      setSuggestions(await api.suggest(id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  };

  const a = area.data;
  const top = a?.issues[0];
  const total = a?.issues.reduce((s, i) => s + i.count, 0) ?? 0;

  const content = (
    <>
      {area.error && <Notice kind="error">{area.error.message}</Notice>}
      {!a && !area.error && (
        <View style={{ gap: 6 }}>
          <Label>ZONE {zoneCode(id)}</Label>
          <Muted>Loading this zone's streets and buildings from OpenStreetMap… The first visit to a new area can take up to a minute.</Muted>
        </View>
      )}
      {a && (
        <>
          <View style={{ gap: 6 }}>
            <Label>ZONE {zoneCode(id)}</Label>
            <H1 size={wide ? 32 : 26}>{a.name}</H1>
            <Body style={{ fontSize: wide ? 15 : 14 }}>{describeArea(a)}</Body>
          </View>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            {a.issuesSource ? (
              <>
                <Stat value={total.toLocaleString()} caption="311 complaints, 90 days" />
                <Stat value={top ? (ISSUE_LABELS[top.category] ?? top.category).split(' ')[0] : '—'} caption={top ? `Top issue · ${top.count}` : 'No complaints'} />
              </>
            ) : (
              <>
                <Stat value={String(a.scene.buildings.length)} caption="Buildings" />
                <Stat value={String(new Set(a.scene.streets.map((st) => st.name)).size)} caption="Streets" />
              </>
            )}
            <Stat value={String(waiting)} caption="Requests waiting" highlight />
          </View>

          <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <H2 style={{ fontSize: wide ? 18 : 17 }}>Requested changes</H2>
            {list.length > 1 && <Muted>Most confirmed first</Muted>}
          </Row>
          {requests.error && <Notice kind="error">{requests.error.message}</Notice>}
          {list.length === 0 && !requests.loading && (
            <View style={[styles.empty, { borderColor: t.border }]}>
              <Muted>No changes have been requested in this zone yet.</Muted>
            </View>
          )}
          {list.map((p) => (
            <RequestCard key={p.id} proposal={p} scene={a.scene} onChanged={requests.refresh} />
          ))}

          {error && <Notice kind="error">{error}</Notice>}

          {suggestions && (
            <View style={{ gap: 10 }}>
              <H2>AI ideas</H2>
              {suggestions.length === 0 && <Muted>No ideas fit this zone this time.</Muted>}
              {suggestions.map((s, i) => (
                <Card key={i} style={{ borderColor: t.aiLine }}>
                  <Row>
                    <Pill label="AI suggested" kind="ai" />
                    {s.addresses.map((c) => <Pill key={c} label={ISSUE_LABELS[c] ?? c} kind="neutral" />)}
                  </Row>
                  <Text style={{ color: t.text, fontFamily: fonts.bodySemi, fontSize: 16 }}>{s.title}</Text>
                  <Body>{s.rationale}</Body>
                  {s.ops.map((op, k) => <Muted key={k}>• {describeOp(op, a.scene)}</Muted>)}
                  <Muted>Estimated {money(s.cost.total)}</Muted>
                  <Button title="Review and edit this idea" kind="secondary" small onPress={() => startDraft(s)} busy={creating} />
                </Card>
              ))}
            </View>
          )}

          {!!drafts.data?.length && (
            <View style={{ gap: 8 }}>
              <H2>Your unsent drafts</H2>
              {drafts.data.map((d) => (
                <Pressable key={d.id} onPress={() => router.push({ pathname: '/draft/[id]', params: { id: d.id } })} style={[styles.draftRow, { borderColor: t.border }]}>
                  <Text style={{ color: t.text, fontFamily: fonts.bodyMedium, fontSize: 14, flex: 1 }}>{d.title}</Text>
                  <Muted>{d.ops.length} change{d.ops.length === 1 ? '' : 's'}</Muted>
                </Pressable>
              ))}
            </View>
          )}

          <View style={{ gap: 10, marginTop: 4 }}>
            <Button
              title={wide ? 'Request a change in this zone' : 'Request a change'}
              icon={<Icon name="plus" size={20} color={t.accentText} strokeWidth={2.4} />}
              onPress={() => startDraft()}
              busy={creating}
            />
            <Button title="Get AI ideas for this zone" kind="ai" onPress={suggest} busy={suggesting} small />
          </View>
        </>
      )}
    </>
  );

  const map =
    camera ? (
      <ZoneMap
        style={StyleSheet.absoluteFill}
        zones={mapZones}
        quietGrid
        onZonePress={(z) => z !== id && router.replace({ pathname: '/area/[id]', params: { id: z } })}
        initialCamera={camera}
        focus={camera}
        controls={wide ? { right: 504, bottom: 24 } : { right: 12, bottom: 92 }}
      />
    ) : null;

  if (wide) {
    return (
      <View style={{ flex: 1, backgroundColor: t.water }}>
        <TopBar current="index" />
        <View style={{ flex: 1 }}>
        {map}
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="link"
          style={[styles.allZones, { backgroundColor: t.card, borderColor: 'transparent' }, shadow]}
        >
          <Icon name="back" size={20} />
          <Text style={{ color: t.text, fontFamily: fonts.bodySemi, fontSize: 14 }}>All zones</Text>
        </Pressable>
        <ScrollView
          style={[styles.side, { backgroundColor: t.card, borderLeftColor: t.border }]}
          contentContainerStyle={{ padding: 28, paddingBottom: 24, gap: 18 }}
          accessibilityLabel="Zone details"
        >
          {content}
        </ScrollView>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.water }}>
      <View style={{ height: 300 + insets.top }}>{map}</View>
      <IconButton
        label="Back to map"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        tint="#FFFFFF"
        style={[{ position: 'absolute', left: 16, top: insets.top + 12, borderColor: 'transparent' }, shadow]}
      >
        <Icon name="back" size={20} />
      </IconButton>
      <ScrollView
        style={[styles.sheet, { backgroundColor: t.card, borderTopColor: t.border }]}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: insets.bottom + 24, gap: 16 }}
        accessibilityLabel="Zone details"
      >
        <View style={[styles.handle, { backgroundColor: t.borderStrong }]} />
        {content}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, marginTop: -24, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center' },
  side: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 480, borderLeftWidth: 1 },
  allZones: { position: 'absolute', left: 24, top: 24, height: 44, paddingLeft: 10, paddingRight: 16, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 16, padding: 16 },
  draftRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
});
