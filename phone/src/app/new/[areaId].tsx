import { BuildingUse, type AreaDetail, type ChangeOp, type CostEstimate, type Draft, type RenderJobInfo } from '@mamdani/shared';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { PickerMap } from '@/components/PickerMap';
import { BottomBar, Button, Fade, H2, Header, IconButton, Notice, Pill, Press, Progress, Rise, Section, Segmented, Shimmer, Stepper, T, Toggle } from '@/components/ui';
import { useApi } from '@/lib/data';
import { costRange } from '@/lib/format';
import { autoTitle, newOp, opWhere, TYPE, TYPES, type OpType } from '@/lib/ops';
import { useSettings } from '@/lib/settings';
import { fonts } from '@/lib/theme';
import { useRenderEvents } from '@/lib/useRenderEvents';

const USE_LABELS: Record<BuildingUse, string> = {
  affordable_housing: 'Affordable homes',
  mixed_use: 'Mixed use',
  community_center: 'Community centre',
  school: 'School',
  clinic: 'Clinic',
};

export default function NewRequest() {
  const { areaId, draft: draftParam } = useLocalSearchParams<{ areaId: string; draft?: string }>();
  const { colors: c } = useSettings();
  const api = useApi();
  const [area, setArea] = useState<AreaDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(draftParam ?? null);
  const [ops, setOps] = useState<ChangeOp[]>([]);
  const [title, setTitle] = useState('');
  const [why, setWhy] = useState('');
  const [placing, setPlacing] = useState<OpType | null>(null);
  const [points, setPoints] = useState<[number, number][]>([]);
  const [treeShape, setTreeShape] = useState<'line' | 'area'>('line');
  const [cost, setCost] = useState<CostEstimate | null>(null);
  const [render, setRender] = useState<RenderJobInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const saveChain = useRef<Promise<Draft | null>>(Promise.resolve(null));
  // The draft's id for queued saves (state would be a render behind when two saves are queued).
  const draftRef = useRef<string | null>(draftParam ?? null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [a, d] = await Promise.all([api.area(areaId), draftParam ? api.draft(draftParam) : Promise.resolve(null)]);
        if (cancelled) return;
        setArea(a);
        if (d) {
          setOps(d.ops);
          setTitle(d.title === autoTitle(d.ops, a) ? '' : d.title);
          setWhy(d.description);
          setCost(d.cost);
          setRender(d.render);
        }
        loaded.current = true;
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, areaId, draftParam]);

  /** Save to the laptop: it prices the request and starts building its 3D model in the background. */
  const save = () => {
    const run = async (): Promise<Draft | null> => {
      const id = draftRef.current;
      if (!ops.length && !id) return null;
      setSaving(true);
      try {
        const body = { title: title.trim() || autoTitle(ops, area), description: why.trim(), ops };
        const d = id ? await api.updateDraft(id, body) : await api.createDraft({ areaId, ...body });
        draftRef.current = d.id;
        setDraftId(d.id);
        setCost(d.cost);
        setRender((cur) => (cur && d.render && cur.hash === d.render.hash && cur.status === 'done' ? cur : d.render));
        setError(null);
        return d;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setSaving(false);
      }
    };
    // One save at a time, in order, so a quick second edit never creates a second draft.
    saveChain.current = saveChain.current.then(run, run);
    return saveChain.current;
  };

  const key = JSON.stringify([ops, title, why]);
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => void save(), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useRenderEvents((e) => {
    if (!draftId || e.draftId !== draftId) return;
    setRender((cur) => (cur && cur.hash !== e.job.hash && e.job.status !== 'queued' ? cur : e.job));
  });

  const add = (op: ChangeOp | null) => {
    if (!op) return;
    void Haptics.selectionAsync().catch(() => {});
    setOps((cur) => [...cur, op]);
    setPlacing(null);
    setPoints([]);
  };
  const pick = (type: OpType) => {
    setPoints([]);
    setPlacing(placing === type ? null : type);
  };
  const update = (i: number, patch: Partial<ChangeOp>) => setOps((cur) => cur.map((o, k) => (k === i ? ({ ...o, ...patch } as ChangeOp) : o)));
  const remove = (i: number) => setOps((cur) => cur.filter((_, k) => k !== i));
  const undo = () => (points.length ? setPoints((p) => p.slice(0, -1)) : setOps((cur) => cur.slice(0, -1)));

  const info = placing ? TYPE[placing] : null;
  const canFinish = placing === 'add_park' ? points.length >= 3 : placing === 'plant_trees' ? points.length >= (treeShape === 'area' ? 3 : 2) : false;
  const hint = info
    ? placing === 'plant_trees'
      ? treeShape === 'line' ? 'Tap along the street where trees go' : 'Tap the corners of the area'
      : info.hint
    : ops.length ? 'Pick another change below, or submit' : 'Pick a change below';
  const building = !!render && ['queued', 'building', 'lod_ready'].includes(render.status);

  const close = () => {
    if (!draftId) return router.back();
    Alert.alert('Keep this request as a draft?', 'It hasn’t been submitted, so nobody else has seen it. Drafts are listed on the zone.', [
      { text: 'Keep draft', onPress: async () => { await save(); router.back(); } },
      { text: 'Discard', style: 'destructive', onPress: async () => { await api.deleteDraft(draftId).catch(() => {}); router.back(); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const d = await save();
      if (!d) throw new Error('Add at least one change before submitting.');
      const res = await api.confirmDraft(d.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace({ pathname: '/petition/[proposalId]', params: { proposalId: res.proposalId, submitted: '1' } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError || !area) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <Header title="New request" onBack={() => router.back()} backIcon="close" />
        <View style={{ padding: 16, gap: 12 }}>
          {loadError ? <Notice kind="error">{loadError}</Notice> : (
            <>
              <T size={14} color={c.text2}>Loading this zone’s streets and buildings…</T>
              <Shimmer style={{ height: 250 }} />
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="New request" subtitle={area.name} onBack={close} backIcon="close"
        right={
          <Press onPress={async () => { if (ops.length) await save(); router.back(); }} accessibilityRole="button" style={{ height: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center' }}>
            <T size={14} weight="medium" color={c.link}>{ops.length ? 'Save draft' : 'Cancel'}</T>
          </Press>
        } />
      <ScrollView contentContainerStyle={{ paddingBottom: 190, gap: 8 }} keyboardShouldPersistTaps="handled">
        <View>
          <PickerMap
            area={area}
            ops={ops}
            pick={info?.pick ?? null}
            treeShape={treeShape}
            points={points}
            onStreet={(streetId) => placing && add(newOp(placing, { streetId }))}
            onBuilding={(buildingId) => placing && add(newOp(placing, { buildingId }))}
            onPoint={(p) => {
              if (placing === 'add_crosswalk') return add(newOp(placing, { points: [p] }));
              setPoints((cur) => [...cur, p]);
            }}
          />
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 12, alignItems: 'center' }}>
            <Fade key={hint} style={{ height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.toast, justifyContent: 'center' }}>
              <T size={13} weight="medium" color={c.onToast} accessibilityLiveRegion="polite">{hint}</T>
            </Fade>
          </View>
          {canFinish && (
            <Press onPress={() => add(newOp(placing!, { points, treeShape }))} accessibilityRole="button"
              style={{ position: 'absolute', left: 12, bottom: 12, height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: c.primary, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="check" size={18} color={c.onPrimary} width={2.4} />
              <T size={14} weight="medium" color={c.onPrimary}>Done</T>
            </Press>
          )}
          {(points.length > 0 || ops.length > 0) && (
            <IconButton icon="undo" label={points.length ? 'Undo last point' : 'Undo last change'} onPress={undo} bg={c.raised} elevated iconSize={20}
              style={{ position: 'absolute', right: 12, bottom: 12 }} />
          )}
        </View>

        <Section delay={120}>
          <H2>Add a change</H2>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {TYPES.map((t) => {
              const on = t.type === placing;
              return (
                <Press key={t.type} onPress={() => pick(t.type)} accessibilityRole="button" accessibilityState={{ selected: on }} haptic
                  style={{ width: '22.9%', flexGrow: 1, minHeight: 72, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 6,
                    borderWidth: on ? 2 : 1, borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accentBg : c.surface }}>
                  <Icon name={t.icon} size={22} color={on ? c.accentFg : c.text3} width={1.9} />
                  <T size={12} weight="medium" color={on ? c.accentFg : c.text3} style={{ textAlign: 'center', lineHeight: 14 }}>{t.label}</T>
                </Press>
              );
            })}
          </View>
          {placing === 'plant_trees' && (
            <Segmented options={[{ id: 'line', label: 'Along a street' }, { id: 'area', label: 'In an area' }]} value={treeShape} look="outline"
              onChange={(v) => { setTreeShape(v); setPoints([]); }} label="Where the trees go" />
          )}
        </Section>

        <Section delay={220}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <H2>Changes in this request</H2>
            <T size={13} color={c.text2}>{ops.length}</T>
          </View>
          {ops.length === 0 && <T size={13} color={c.text2}>Nothing yet. Pick a kind of change above, then tap the map.</T>}
          {ops.map((op, i) => (
            <Rise key={`${i}-${op.type}`} from={10} style={{ borderWidth: 1, borderColor: c.line, borderRadius: 12, padding: 12, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.okBg, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={TYPE[op.type].icon} size={20} color={c.okFg} width={1.9} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T size={15} weight="medium">{TYPE[op.type].label}</T>
                  <T size={12} color={c.text2} numberOfLines={1}>{opWhere(op, area)}</T>
                </View>
                <IconButton icon="trash" label={`Remove ${TYPE[op.type].label.toLowerCase()}`} onPress={() => remove(i)} iconSize={20} color={c.text2} style={{ marginRight: -8 }} />
              </View>
              <OpOptions op={op} onChange={(patch) => update(i, patch)} />
            </Rise>
          ))}
        </Section>

        <Section delay={320}>
          <H2>Describe it</H2>
          <View style={{ gap: 6 }}>
            <T size={12} weight="medium" color={c.text2}>Title</T>
            <TextInput value={title} onChangeText={setTitle} maxLength={120} placeholder={ops.length ? autoTitle(ops, area) : 'e.g. Protected bike lane on Bleecker St'} placeholderTextColor={c.muted} accessibilityLabel="Title"
              style={{ height: 48, paddingHorizontal: 14, borderWidth: 1, borderColor: c.line, borderRadius: 10, fontSize: 16, fontFamily: fonts.regular, color: c.text }} />
          </View>
          <View style={{ gap: 6 }}>
            <T size={12} weight="medium" color={c.text2}>Why does this matter?</T>
            <TextInput value={why} onChangeText={setWhy} maxLength={4000} multiline placeholder="What problem does it solve for people here?" placeholderTextColor={c.muted} accessibilityLabel="Why does this matter?"
              style={{ minHeight: 88, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, borderWidth: 1, borderColor: c.line, borderRadius: 10, fontSize: 16, fontFamily: fonts.regular, color: c.text, textAlignVertical: 'top' }} />
          </View>
        </Section>
        {error && <Notice kind="error" style={{ marginHorizontal: 12 }}>{error}</Notice>}
      </ScrollView>

      <BottomBar>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ gap: 2 }}>
            <T size={12} color={c.text2}>Estimated cost</T>
            <Fade key={costRange(cost)}>
              <T size={20} weight="medium" style={{ fontVariant: ['tabular-nums'] }}>{ops.length ? costRange(cost) : '$0'}</T>
            </Fade>
          </View>
          {building ? (
            <View accessibilityRole="progressbar" accessibilityLabel="Building 3D preview" style={{ width: 150, gap: 6, alignItems: 'flex-end' }}>
              <T size={12} weight="medium" color={c.text2}>Building 3D preview</T>
              <View style={{ width: 150 }}><Progress frac={render?.status === 'lod_ready' ? 0.8 : render?.status === 'building' ? 0.5 : 0.15} height={4} delay={0} /></View>
            </View>
          ) : render?.status === 'done' && ops.length ? (
            <Pill label="3D preview ready" bg={c.okBg} fg={c.okFg} icon="check" height={28} />
          ) : saving ? (
            <T size={12} color={c.text2}>Saving…</T>
          ) : null}
        </View>
        <Button title={submitting ? 'Submitting…' : 'Submit request'} busy={submitting} disabled={!ops.length || submitting} onPress={submit} />
      </BottomBar>
    </KeyboardAvoidingView>
  );
}

/** The settings for one change (side, protected, floors…). */
function OpOptions({ op, onChange }: { op: ChangeOp; onChange: (patch: Partial<ChangeOp>) => void }) {
  const { colors: c } = useSettings();
  const side = 'side' in op ? (
    <View style={{ gap: 6 }}>
      <T size={12} weight="medium" color={c.text2}>Side</T>
      <Segmented look="outline" label="Side of street" value={op.side} onChange={(s) => onChange({ side: s } as Partial<ChangeOp>)}
        options={[{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }, { id: 'both', label: 'Both' }]} />
    </View>
  ) : null;
  switch (op.type) {
    case 'add_bike_lane':
      return (
        <>
          {side}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
            <View style={{ flex: 1 }}>
              <T size={14}>Protected</T>
              <T size={12} color={c.text2}>Flexible posts and a painted buffer</T>
            </View>
            <Toggle label="Protected" value={op.protected} onChange={(v) => onChange({ protected: v })} />
          </View>
        </>
      );
    case 'add_bus_lane':
    case 'remove_parking':
      return side;
    case 'widen_sidewalk':
      return <Stepper label="Extra width per side" value={op.meters} min={0.5} max={6} step={0.5} suffix=" m" onChange={(meters) => onChange({ meters })} />;
    case 'plant_trees':
      return <Stepper label="Trees" value={op.count} min={1} max={200} step={op.count >= 20 ? 5 : 1} onChange={(count) => onChange({ count })} />;
    case 'add_crosswalk':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
          <View style={{ flex: 1 }}>
            <T size={14}>Raised</T>
            <T size={12} color={c.text2}>At sidewalk height, so cars slow down</T>
          </View>
          <Toggle label="Raised crosswalk" value={op.raised} onChange={(raised) => onChange({ raised })} />
        </View>
      );
    case 'add_park':
      return (
        <TextInput value={op.name ?? ''} onChangeText={(name) => onChange({ name: name || undefined })} maxLength={80} placeholder="Park name (optional)" placeholderTextColor={c.muted} accessibilityLabel="Park name"
          style={{ height: 44, paddingHorizontal: 14, borderWidth: 1, borderColor: c.line, borderRadius: 10, fontSize: 16, fontFamily: fonts.regular, color: c.text }} />
      );
    case 'replace_building':
      return (
        <>
          <Stepper label="Floors" value={op.floors} min={1} max={40} onChange={(floors) => onChange({ floors })} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {BuildingUse.options.map((u) => {
              const on = op.use === u;
              return (
                <Press key={u} onPress={() => onChange({ use: u, units: u === 'affordable_housing' ? op.units : 0 })} accessibilityRole="button" accessibilityState={{ selected: on }}
                  style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', borderWidth: on ? 0 : 1, borderColor: c.line, backgroundColor: on ? c.accentBg : c.surface }}>
                  <T size={13} weight="medium" color={on ? c.accentFg : c.text3}>{USE_LABELS[u]}</T>
                </Press>
              );
            })}
          </View>
          {op.use === 'affordable_housing' && (
            <Stepper label={op.units ? 'Homes' : 'Homes (worked out from floor area)'} value={op.units} min={0} max={1000} step={10} onChange={(units) => onChange({ units })} />
          )}
        </>
      );
  }
}
