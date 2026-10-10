import type { AreaDetail, ChangeOp, Draft, RenderJobInfo } from '@mamdani/shared';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '@/components/AppNav';
import { buildOp, ChangeBuilder, EMPTY_BUILDER, mapHandlers, pickLabel, selectionText, type BuilderState } from '@/components/ChangeBuilder';
import { Icon } from '@/components/icons';
import { PickerMap } from '@/components/PickerMap';
import { ChangePreview } from '@/components/ChangePreview';
import type { ThreeViewHandle } from '@/components/three/rig';
import { Button, H1, IconButton, Label, Mono, Muted, Notice } from '@/components/ui';
import { useApi } from '@/lib/data';
import { describeOp } from '@/lib/ops';
import { fonts, money, useIsWide, useTheme, zoneCode } from '@/lib/theme';
import { useRenderEvents } from '@/lib/useRenderEvents';

/** "Protected bike lane on Delancey St (both sides) + 1 more" */
const autoTitle = (ops: ChangeOp[], area: AreaDetail | null) =>
  ops.length ? describeOp(ops[0], area?.scene) + (ops.length > 1 ? ` + ${ops.length - 1} more` : '') : 'New request';

export default function NewRequest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const wide = useIsWide();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const viewer = useRef<ThreeViewHandle>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [area, setArea] = useState<AreaDetail | null>(null);
  const [committed, setCommitted] = useState<ChangeOp[]>([]);
  const [builder, setBuilder] = useState<BuilderState>(EMPTY_BUILDER);
  const [note, setNote] = useState('');
  const [render, setRender] = useState<RenderJobInfo | null>(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.draft(id);
        const a = await api.area(d.areaId);
        if (cancelled) return;
        setDraft(d);
        setArea(a);
        setCommitted(d.ops); // e.g. an AI idea, or a draft reopened later
        setNote(d.source === 'ai_suggested' ? '' : d.description);
        setRender(d.render);
        loaded.current = true;
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  const current = useMemo(() => buildOp(builder), [builder]);
  const ops = useMemo(() => (current ? [...committed, current] : committed), [committed, current]);
  const opsKey = JSON.stringify(ops);

  // Save as you go: every complete change re-prices and re-renders in the background.
  useEffect(() => {
    if (!loaded.current || !draft) return;
    const timer = setTimeout(async () => {
      setSaving(true);
      try {
        const ai = draft.source === 'ai_suggested';
        const d = await api.updateDraft(id, { ops, ...(ai ? {} : { title: autoTitle(ops, area), description: note }) });
        setDraft(d);
        setRender(d.render);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSaving(false);
      }
    }, 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsKey, note]);

  useRenderEvents((e) => {
    if (e.draftId !== id) return;
    setRender((cur) => (cur && cur.hash !== e.job.hash ? cur : e.job));
  });

  const ready = render?.status === 'done' && ops.length > 0;
  const close = () =>
    router.canGoBack() ? router.back() : draft ? router.replace({ pathname: '/area/[id]', params: { id: draft.areaId } }) : router.replace('/');

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const thumb = preview ? ((await viewer.current?.snapshot()) ?? undefined) : undefined;
      const res = await api.confirmDraft(id, thumb);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace({ pathname: '/proposal/[id]', params: { id: res.proposalId } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const discard = () => {
    const doDiscard = async () => {
      await api.deleteDraft(id).catch(() => {});
      close();
    };
    // Alert buttons don't exist in the browser; use its own confirm there.
    if (Platform.OS === 'web') {
      if (window.confirm('Discard this request? It has not been submitted, so nobody else has seen it.')) void doDiscard();
      return;
    }
    Alert.alert('Discard this request?', 'It has not been submitted, so nobody else has seen it.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: doDiscard },
    ]);
  };

  const addAnother = () => {
    if (!current) return;
    setCommitted((c) => [...c, current]);
    setBuilder(EMPTY_BUILDER);
  };

  if (error && !draft) return <View style={{ padding: 16, paddingTop: insets.top + 16 }}><Notice kind="error">{error}</Notice></View>;
  if (!draft || !area) return <View style={{ padding: 16, paddingTop: insets.top + 16 }}><Muted>Loading…</Muted></View>;

  const panel = (
    <>
      {draft.source === 'ai_suggested' && <Notice>Started from an AI idea. Check every change — you decide what is submitted.</Notice>}
      {committed.length > 0 && (
        <View style={{ gap: 8 }}>
          <Label>IN THIS REQUEST</Label>
          {committed.map((op, i) => (
            <View key={i} style={[styles.opRow, { borderColor: t.border, backgroundColor: t.inner }]}>
              <Text style={{ color: t.text, fontFamily: fonts.body, fontSize: 14, flex: 1 }}>{describeOp(op, area.scene)}</Text>
              <Pressable hitSlop={10} onPress={() => setCommitted((c) => c.filter((_, k) => k !== i))} accessibilityRole="button" accessibilityLabel="Remove this change">
                <Icon name="close" size={18} color={t.muted} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <ChangeBuilder area={area} value={builder} onChange={setBuilder} mapInline={!wide} />
      {current && <Button small kind="outline" title="+ Add another change" onPress={addAnother} />}
      {ops.length > 0 && (
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Why this change? (optional)"
          placeholderTextColor={t.muted}
          multiline
          maxLength={4000}
          style={[styles.note, { color: t.text, borderColor: t.border, backgroundColor: t.inner }]}
        />
      )}
      {!wide && preview && ready && render && <ChangePreview ref={viewer} lods={render.lods} ops={ops} scene={area.scene} height={340} />}
      {error && <Notice kind="error">{error}</Notice>}
      <Pressable onPress={discard} accessibilityRole="button" style={{ alignSelf: 'center', padding: 8 }}>
        <Muted>Discard request</Muted>
      </Pressable>
    </>
  );

  const footer = (
    <View style={[styles.footer, { borderTopColor: t.divider, backgroundColor: t.nav, paddingBottom: wide ? 20 : Math.max(22, insets.bottom + 8) }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }}>
          Estimated cost
          {ops.length > 0 && (
            <>
              {' · '}
              {ready ? (
                <Text onPress={() => setPreview((v) => !v)} style={{ color: t.accent, textDecorationLine: 'underline' }} accessibilityRole="button">
                  {preview ? 'hide preview' : 'preview ready'}
                </Text>
              ) : (
                <Text style={{ color: t.muted }}>{saving ? 'saving…' : 'building preview…'}</Text>
              )}
            </>
          )}
        </Text>
        <Mono size={wide ? 22 : 20}>{ops.length ? money(draft.cost.total) : '—'}</Mono>
      </View>
      <Button title="Submit request" onPress={submit} busy={submitting} disabled={ops.length === 0} />
    </View>
  );

  if (wide) {
    const handlers = mapHandlers(builder, (patch) => setBuilder({ ...builder, ...patch }));
    const picked = selectionText(area, builder);
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <TopBar current="index" />
        <View style={styles.grid}>
          <View style={{ flex: 1, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
              <Label>{preview && ready ? 'PREVIEW · HOW IT WOULD LOOK' : pickLabel(handlers.pick, builder.treeShape)}</Label>
              {ready && <Button small kind="secondary" title={preview ? 'Back to map' : 'Preview'} onPress={() => setPreview((v) => !v)} />}
            </View>
            {preview && ready && render ? (
              <ChangePreview ref={viewer} lods={render.lods} ops={ops} scene={area.scene} />
            ) : (
              <View style={{ flex: 1 }}>
                <PickerMap area={area} pick={handlers.pick} treeShape={builder.treeShape} streetId={builder.streetId} buildingId={builder.buildingId}
                  points={builder.points} onStreet={handlers.onStreet} onBuilding={handlers.onBuilding} onMapPress={handlers.onMapPress} height="fill" />
                <View style={[styles.mapTag, { left: 16, top: 16, borderColor: t.border, backgroundColor: t.bg + 'cc' }]} pointerEvents="none">
                  <Text style={{ color: t.soft, fontFamily: fonts.body, fontSize: 13 }}>Zone {zoneCode(area.id)} · {area.name}</Text>
                </View>
                {picked && (
                  <View style={[styles.mapTag, { left: 16, bottom: 16, borderColor: t.forestLine, backgroundColor: t.bg + 'cc' }]} pointerEvents="none">
                    <Text style={{ color: t.accent, fontFamily: fonts.bodySemi, fontSize: 14 }}>{picked} · selected</Text>
                  </View>
                )}
              </View>
            )}
          </View>
          <View style={[styles.side, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={styles.sideHeader}>
              <H1 size={24}>New request</H1>
              <IconButton label="Close" onPress={close} tint="transparent" style={{ borderWidth: 0 }}><Icon name="close" size={22} /></IconButton>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 20, gap: 18 }} keyboardShouldPersistTaps="handled">
              {panel}
            </ScrollView>
            {footer}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <IconButton label="Close" onPress={close} tint="transparent" style={{ borderWidth: 0 }}><Icon name="close" size={22} /></IconButton>
        <Text style={{ color: t.text, fontFamily: fonts.displayBold, fontSize: 17 }}>New request</Text>
        <View style={{ width: 44 }} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 18 }} keyboardShouldPersistTaps="handled">
        {panel}
      </ScrollView>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 4 },
  footer: { borderTopWidth: 1, paddingHorizontal: 20, paddingTop: 14, gap: 10 },
  opRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  note: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 72, fontSize: 15, textAlignVertical: 'top' },
  grid: { flex: 1, flexDirection: 'row', gap: 24, paddingHorizontal: 32, paddingTop: 24, paddingBottom: 32 },
  side: { width: 480, borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  sideHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 24, paddingRight: 14, paddingTop: 14, paddingBottom: 6 },
  mapTag: { position: 'absolute', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
});
