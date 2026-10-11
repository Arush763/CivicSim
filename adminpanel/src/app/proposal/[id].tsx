import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '@/components/AppNav';
import { Icon } from '@/components/icons';
import { DecisionBar, StatusChip } from '@/components/requests';
import { ChangePreview } from '@/components/ChangePreview';
import { Body, Button, Card, H1, H2, IconButton, Label, Mono, Muted, Notice, Pill } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fetchProposal, fetchProposals, petitionForProposal, useApi, useAsync, useProposalUpdates, type Petition } from '@/lib/data';
import { describeOp } from '@/lib/ops';
import { fonts, money, useIsWide, useTheme, zoneCode } from '@/lib/theme';
import { isWaiting } from '@/lib/zones';

/** A stored render keeps lod0's URL; its lower-detail siblings sit next to it. */
const lodsFrom = (lod0: string | null) => lod0 ? [0, 1, 2].map((l) => lod0.replace(/lod0\.glb$/, `lod${l}.glb`)) : [];

export default function RequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const wide = useIsWide();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { devMode } = useAuth();
  const proposal = useAsync(() => fetchProposal(id), [id]);
  useProposalUpdates(proposal.refresh, id);
  const p = proposal.data;
  const area = useAsync(async () => (p ? api.area(p.area_id) : null), [api, p?.area_id]);
  const siblings = useAsync(async () => (p ? fetchProposals({ areaId: p.area_id }) : []), [p?.area_id]);
  const [petition, setPetition] = useState<Petition | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (devMode) return;
    void petitionForProposal(id).then(setPetition);
  }, [id, devMode]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const back = () => (router.canGoBack() ? router.back() : p ? router.replace({ pathname: '/area/[id]', params: { id: p.area_id } }) : router.replace('/'));

  if (proposal.error) return <View style={{ padding: 16 }}><Notice kind="error">{proposal.error.message}</Notice></View>;
  if (!p) return <View style={{ padding: 16, paddingTop: insets.top + 16 }}><Muted>{proposal.loading ? 'Loading…' : 'Request not found.'}</Muted></View>;

  const crumb = `${zoneCode(p.area_id)}${area.data ? ` · ${area.data.name.toUpperCase()}` : ''}`;
  const others = (siblings.data ?? []).filter((s) => s.id !== p.id && isWaiting(s)).length;

  const details = (
    <>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <StatusChip status={p.status} long />
          {p.source === 'ai_suggested' && <Pill label="Started from AI suggestion" kind="ai" />}
        </View>
        <H1 size={wide ? 34 : 24}>{p.title}</H1>
        {p.ops.map((op, i) => (
          <Body key={i} style={{ fontSize: wide ? 16 : 14 }}>{describeOp(op, area.data?.scene)}.</Body>
        ))}
        {!!p.description && <Body style={{ fontSize: wide ? 16 : 14, color: t.muted }}>{p.description}</Body>}
      </View>

      <View style={[styles.cost, { backgroundColor: t.card, borderColor: t.border, padding: wide ? 18 : 14 }]}>
        <View style={{ gap: 2 }}>
          <Muted>Estimated cost</Muted>
          <Muted style={{ fontSize: 11 }}>{p.cost ? `range ${money(p.cost.low)} – ${money(p.cost.high)}` : 'Calculated during processing'}</Muted>
        </View>
        <Mono size={wide ? 30 : 24}>{p.cost ? money(p.cost.total) : 'Pending'}</Mono>
      </View>

      {p.processing_status && p.processing_status !== 'ready' && <Notice kind={p.processing_status === 'failed' ? 'error' : undefined}>
        {p.processing_status === 'failed' ? 'Processing failed. Retry this request from the admin panel.' : p.processing_status === 'running' ? 'Preparing this request’s preview…' : 'Request received. Waiting for processing…'}
      </Notice>}
      {p.processing_status === 'failed' && <Button title="Retry preview" busy={busy} onPress={() => run(async () => { await api.processRequest(id); await proposal.refresh(); })} />}

      <DecisionBar proposal={p} onChanged={proposal.refresh} size="large" />

      {!devMode && (
        <Card>
          <H2>Petition</H2>
          {petition ? (
            <>
              <Muted>{petition.signature_count} of {petition.goal} signatures{petition.status === 'goal_reached' ? ' — goal reached!' : ''}</Muted>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: t.border }}>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: t.accent, width: `${Math.min(100, (petition.signature_count / petition.goal) * 100)}%` }} />
              </View>
            </>
          ) : (
            <Muted>No petition yet. The person who requested this can start one in the phone app.</Muted>
          )}
        </Card>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </>
  );

  if (wide) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <TopBar current="index" />
        <View style={styles.grid}>
          <View style={{ flex: 1, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <IconButton label="Back to zone" onPress={back} tint="transparent"><Icon name="back" size={20} /></IconButton>
              <Label color={t.muted}>{crumb}</Label>
            </View>
            <View style={{ flex: 1 }}>
              <ChangePreview lods={lodsFrom(p.after_url)} ops={p.ops} scene={area.data?.scene} />
            </View>
          </View>
          <ScrollView style={{ width: 440, flexGrow: 0 }} contentContainerStyle={{ gap: 18, paddingTop: 58, paddingBottom: 24 }}>
            {details}
            <Pressable
              onPress={() => router.push({ pathname: '/area/[id]', params: { id: p.area_id } })}
              accessibilityRole="link"
              style={[styles.zoneLink, { borderColor: t.border, backgroundColor: t.card }]}
            >
              <View style={[styles.zoneIcon, { backgroundColor: t.forest }]}><Icon name="cube" size={20} color={t.accent} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: t.text, fontFamily: fonts.bodySemi, fontSize: 14 }}>Zone {zoneCode(p.area_id)}</Text>
                <Muted>{others ? `${others} other request${others === 1 ? '' : 's'} waiting here` : 'See this zone'}</Muted>
              </View>
              <Icon name="chevron" size={18} color={t.muted} />
            </Pressable>
          </ScrollView>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <IconButton label="Back to zone" onPress={back} tint="transparent" style={{ borderWidth: 0 }}><Icon name="back" size={22} /></IconButton>
        <Label color={t.muted} style={{ flex: 1 }}>{crumb}</Label>
      </View>
      <View style={{ marginHorizontal: 16 }}>
        <ChangePreview lods={lodsFrom(p.after_url)} ops={p.ops} scene={area.data?.scene} height={360} />
      </View>
      <View style={{ paddingHorizontal: 20, paddingTop: 18, gap: 14 }}>{details}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 6 },
  cost: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 14, borderWidth: 1 },
  grid: { flex: 1, flexDirection: 'row', gap: 32, paddingHorizontal: 32, paddingTop: 20, paddingBottom: 32 },
  zoneLink: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  zoneIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
