import { changeFocus, describeRequest, type AreaDetail } from '@mamdani/shared';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Share, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { Avatar, Button, H2, IconButton, Notice, Pill, Pop, Press, Progress, Rise, Screen, Section, Segmented, Shimmer, T } from '@/components/ui';
import { WebPane, type WebPaneHandle } from '@/components/WebPane';
import { useAuth } from '@/lib/auth';
import { SERVER_URL, serverUrl, supabaseEnabled } from '@/lib/config';
import { fetchProposal, hasSigned, sign, useApi, useAsync, useVoting, type Proposal } from '@/lib/data';
import { ago, costRange, money, opKinds, STATUS_LONG, statusColors } from '@/lib/format';
import { modelUrl, streetViewUrl, usePageServer } from '@/lib/streetview';
import { ease } from '@/lib/motion';
import { useSettings } from '@/lib/settings';
import type { Theme } from '@/lib/theme';

type Mode = 'before' | 'compare' | 'after';

export default function RequestScreen() {
  return (
    <Screen>
      <RequestScreenContent />
    </Screen>
  );
}

function RequestScreenContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors: c, quality, photoReal, set } = useSettings();
  const { userId, session } = useAuth();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const req = useAsync(() => fetchProposal(id), [id]);
  const p = req.data;
  const [area, setArea] = useState<AreaDetail | null>(null);
  const [view, setView] = useState<'images' | 'sv' | '3d'>('images');
  const [mode, setMode] = useState<Mode>('compare');
  const [full, setFull] = useState(false);
  const [svProblem, setSvProblem] = useState<string | null>(null);
  const [photoOn, setPhotoOn] = useState(false);
  // The laptop's progress on this request's photo-real views (null until first asked).
  const [prep, setPrep] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const pane = useRef<WebPaneHandle>(null);
  const voting = useVoting(p ? [p] : null);

  useFocusEffect(
    useCallback(() => {
      void req.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]),
  );
  useEffect(() => {
    if (!p) return;
    if (view !== 'images') api.area(p.area_id).then(setArea).catch(() => {});
  }, [api, p?.area_id, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // How far along the laptop is with this request's photo-real views (it starts when it's submitted).
  useEffect(() => {
    if (!p) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    let last = '';
    const poll = async () => {
      const updated = supabaseEnabled ? await fetchProposal(id).catch(() => null) : null;
      if (cancelled) return;
      if (updated) req.setData(updated);
      const s = supabaseEnabled ? updated?.photo_status ?? 'none' : (await api.prerender(id).catch(() => null))?.status ?? 'none';
      if (last && last !== 'done' && s === 'done') setReload((n) => n + 1); // ready now: load the prepared views
      last = s;
      setPrep(s);
      if (!cancelled && (s === 'queued' || s === 'running' || updated?.processing_status === 'queued' || updated?.processing_status === 'running')) timer = setTimeout(poll, 8000);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, id, p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const focus = useMemo(() => (p && area ? changeFocus(p.ops, area.scene) : null), [p, area]);
  // Built once per request (switching Before/After talks to the page instead of reloading it).
  const startMode = useRef<Mode>('compare');
  const pageBase = usePageServer();
  const svUri = useMemo(
    () => (pageBase && p?.after_url && area && focus ? streetViewUrl(pageBase, p.after_url, focus, p.ops, describeRequest(p.ops, area.scene), { token: session?.access_token ?? null, photo: photoReal, mode: startMode.current }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageBase, p?.id, p?.after_url, area?.id, focus?.at.join(','), photoReal, session?.user.id],
  );
  const mUri = useMemo(() => (pageBase && p?.after_url ? modelUrl(pageBase, p.after_url, focus?.at ?? null, quality, c.dark) : null), [pageBase, p?.after_url, focus, quality, c.dark]);

  const pickMode = (m: Mode) => {
    setMode(m);
    startMode.current = m;
    pane.current?.run(`window.__sv && window.__sv.setMode(${JSON.stringify(m)})`);
  };

  if (req.error || (!req.loading && !p)) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 8, paddingHorizontal: 12, gap: 12 }}>
        <IconButton icon="back" label="Back" onPress={() => router.back()} />
        <Notice kind="error">{req.error?.message ?? 'This request could not be found.'}</Notice>
      </View>
    );
  }

  const heroH = full ? screenH : 360;
  // Until Gemini has finished, Street View isn't loaded at all: never the plain photo first.
  const preparing = photoReal && (prep === null || prep === 'queued' || prep === 'running');
  const photoLabel = !photoReal ? 'Photo-real off' : prep === 'queued' || prep === 'running' ? 'Preparing…' : prep === 'failed' ? 'Photo-real failed' : 'Photo-real';

  const hero = (
    <View style={{ height: heroH, backgroundColor: c.stage }}>
      {!p ? (
        <Shimmer style={{ flex: 1, borderRadius: 0 }} />
      ) : view === 'images' ? (
        <SavedPreview p={p} mode={mode} c={c} />
      ) : !area ? (
        <Shimmer style={{ flex: 1, borderRadius: 0 }} />
      ) : view === 'sv' && preparing ? (
        <PreparingCover c={c} waiting={prep !== null} onModel={() => setView('3d')} />
      ) : view === 'sv' && photoReal && prep === 'failed' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 14 }}>
          <Pop style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.waitBg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="photo" size={26} color={c.waitFg} />
          </Pop>
          <Rise delay={120} style={{ alignItems: 'center', gap: 6 }}>
            <T size={17} weight="medium" style={{ textAlign: 'center' }}>The photo-real view couldn’t be made</T>
            <T size={13} color={c.text2} style={{ textAlign: 'center', lineHeight: 19 }}>
              Gemini didn’t build this change into the photos. It can be prepared again from the admin panel on the laptop.
            </T>
          </Rise>
          <Button title="See the 3D model" kind="outline" height={40} onPress={() => setView('3d')} />
        </View>
      ) : view === 'sv' && svUri && !svProblem ? (
        <WebPane key={`sv-${reload}-${svUri}`} ref={pane} uri={svUri} background={c.stage} style={{ flex: 1 }}
          onStatus={(s, m) => {
            if (s === 'nopano') setSvProblem(m ?? 'Google has no Street View photos near this change.');
            if (s === 'error') setSvProblem(m ?? 'Street View could not be shown.');
            if (s === 'photo') setPhotoOn(true);
          }} />
      ) : view === 'sv' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
          <T size={14} color={c.text2} style={{ textAlign: 'center' }}>{svProblem ?? 'There’s nowhere to look at this change from in Street View.'}</T>
          <Button title="See the 3D model" kind="outline" height={44} onPress={() => setView('3d')} />
        </View>
      ) : mUri ? (
        <WebPane key={`m-${mUri}`} uri={mUri} background={c.stage} style={{ flex: 1 }} />
      ) : null}

      {(view === 'images' || (view === 'sv' && svUri && !svProblem && !preparing)) && (
        <View style={{ position: 'absolute', bottom: 14, left: 0, right: 0, alignItems: 'center' }} pointerEvents="box-none">
          <Segmented look="dark" height={36} label="Compare view" style={{ width: 288 }} value={mode} onChange={pickMode}
            options={[{ id: 'before', label: 'Before' }, { id: 'compare', label: 'Compare' }, { id: 'after', label: 'After' }]} />
        </View>
      )}
      <IconButton icon="back" label="Back" onPress={() => (full ? setFull(false) : router.back())} bg={c.raised} elevated
        style={{ position: 'absolute', left: 12, top: insets.top + 8 }} />
      <IconButton icon={full ? 'collapse' : 'expand'} label={full ? 'Exit full screen' : 'Open full screen'} onPress={() => setFull(!full)} bg={c.raised} elevated iconSize={20}
        style={{ position: 'absolute', right: 12, top: insets.top + 8 }} />
    </View>
  );

  if (full) return <View style={{ flex: 1, backgroundColor: c.stage }}>{hero}</View>;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40, gap: 8 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => req.refresh()} />}>
        {hero}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 16, marginTop: 4 }}>
          <Segmented label="Preview type" height={34} style={{ flex: 1 }} value={view} onChange={setView}
            options={[{ id: 'images', label: 'Images' }, ...(SERVER_URL ? [{ id: 'sv' as const, label: 'Street View' }, { id: '3d' as const, label: '3D model' }] : [])]} />
          {view === 'sv' && <Press onPress={() => set({ photoReal: !photoReal })} accessibilityRole="switch" accessibilityState={{ checked: photoReal }} accessibilityLabel="Photo-real views"
            style={{ height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: photoReal ? c.upBorder : c.line, backgroundColor: photoReal ? c.accentBg : c.surface, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {photoReal && (prep === 'done' || photoOn) && <Icon name="check" size={14} color={c.accentFg} width={2.6} />}
            <T size={13} weight="medium" color={photoReal ? c.accentFg : c.text3}>{photoLabel}</T>
          </Press>}
        </View>
        {p && <Details p={p} c={c} voting={voting} userId={userId} onSigned={() => req.refresh()} />}
      </ScrollView>
    </View>
  );
}

/** Cloud-hosted stills need neither a live laptop connection nor a 3D/WebGL renderer. */
function SavedPreview({ p, mode, c }: { p: Proposal; mode: Mode; c: Theme }) {
  const shots = p.snapshots ?? [];
  const before = shots.find((s) => s.kind === 'before');
  const after = shots.find((s) => s.kind === 'after');
  const fallback = shots.find((s) => s.kind === 'angled') ?? shots[0];
  const comparison = [before, after].filter(Boolean);
  const chosen = mode === 'compare' ? (comparison.length ? comparison : [fallback].filter(Boolean)) : [mode === 'before' ? before : after ?? fallback].filter(Boolean);
  if (!chosen.length) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 }}>
      <Icon name="clock" size={28} color={c.text2} />
      <T size={15} weight="medium">{p.processing_status === 'failed' ? 'Preview could not be prepared' : p.processing_status === 'ready' ? 'No saved image for this view' : 'Preview is being prepared'}</T>
      <T size={13} color={c.text2} style={{ textAlign: 'center' }}>
        {p.processing_status === 'failed' ? 'Your request is saved. City staff can retry processing it.' : 'Your request is saved. You can close the app and check back later.'}
      </T>
    </View>
  );
  return <View style={{ flex: 1, flexDirection: 'row' }}>
    {chosen.map((shot) => shot && <View key={shot.kind} style={{ flex: 1 }}>
      <Image source={{ uri: serverUrl(shot.url) }} accessibilityLabel={shot.label} contentFit="contain" cachePolicy="disk" style={{ flex: 1 }} />
      <View style={{ position: 'absolute', top: 80, left: 12, backgroundColor: c.raised, borderRadius: 12, padding: 6 }}><T size={12}>{shot.label}</T></View>
    </View>)}
  </View>;
}

function Details({ p, c, voting, userId, onSigned }: { p: Proposal; c: Theme; voting: ReturnType<typeof useVoting>; userId: string | null; onSigned: () => void }) {
  const st = statusColors(p.status, c);
  const my = voting.my(p.id);
  const mine = !!userId && p.author_id === userId;
  const share = () => Share.share({ message: `${p.title} on CivicSim: civicsim://request/${p.id}` }).catch(() => {});
  const zoneName = p.area_name ?? 'This zone';

  return (
    <>
      <Section delay={100}>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Pill label={STATUS_LONG[p.status]} bg={st.bg} fg={st.fg} dot={st.dot} />
          {opKinds(p.ops).map((k) => <Pill key={k} label={k} bg={c.chip} fg={c.text3} />)}
          {p.source === 'ai_suggested' && <Pill label="AI suggested" bg={c.aiBg} fg={c.aiFg} />}
        </View>
        <T size={22} weight="medium" style={{ lineHeight: 28 }} accessibilityRole="header">{p.title}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Avatar name={p.author?.username ?? (mine ? 'You' : '?')} size={28} bg={c.badBg} fg={c.badFg} />
          <T size={13} color={c.text2} style={{ flex: 1 }}>
            <T size={13} weight="medium">{mine ? 'You' : p.author?.username ?? 'A resident'}</T>
            {p.author?.rank ? ` · ${p.author.rank}` : ''} · {ago(p.created_at)}
          </T>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <VoteButton dir={1} on={my === 1} count={voting.ups(p)} c={c} onPress={() => voting.vote(p.id, 1)} />
          <VoteButton dir={-1} on={my === -1} count={voting.downs(p)} c={c} onPress={() => voting.vote(p.id, -1)} />
          <IconButton icon="share" label="Share request" onPress={share} iconSize={20} style={{ borderWidth: 1, borderColor: c.line }} />
        </View>
        {p.description ? <T size={15} color={c.text3} style={{ lineHeight: 22 }}>{p.description}</T> : null}
        <Press onPress={() => router.push({ pathname: '/zone/[id]', params: { id: p.area_id } })} accessibilityRole="link"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
          <Icon name="map" size={18} color={c.link} />
          <T size={14} weight="medium" color={c.link}>{zoneName} zone</T>
        </Press>
      </Section>

      <Section delay={180} style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <H2>Estimated cost</H2>
          <T size={20} weight="medium" style={{ fontVariant: ['tabular-nums'] }}>{costRange(p.cost)}</T>
        </View>
        {(p.cost?.items ?? []).map((it, i) => (
          <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border }}>
            <T size={14} color={c.text3} style={{ flex: 1 }}>{it.label}</T>
            <T size={14} weight="medium" style={{ fontVariant: ['tabular-nums'] }}>{money(it.total)}</T>
          </View>
        ))}
        {p.cost && <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border }}>
          <T size={14} color={c.text3}>Contingency (20%)</T>
          <T size={14} weight="medium" style={{ fontVariant: ['tabular-nums'] }}>{money(p.cost.contingency)}</T>
        </View>}
        <T size={12} color={c.text2}>Calculated from a fixed table of unit costs, not by AI. The range runs from 30% under to 50% over the total.</T>
      </Section>

      <PetitionCard p={p} c={c} mine={mine} userId={userId} onSigned={onSigned} />

      <Section delay={340} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: p.status === 'accepted' ? c.okBg : p.status === 'rejected' ? c.badBg : c.chip, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={p.status === 'accepted' ? 'check' : p.status === 'rejected' ? 'close' : 'clock'} size={20} color={p.status === 'accepted' ? c.okFg : p.status === 'rejected' ? c.badFg : c.text2} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <H2>{p.status === 'accepted' ? 'Approved by the city' : p.status === 'rejected' ? 'Not approved by the city' : p.status === 'under_review' ? 'The city is reviewing this' : 'City decision pending'}</H2>
          <T size={13} color={c.text2} style={{ lineHeight: 19 }}>
            {p.status === 'accepted'
              ? 'City staff approved this request. Its author earned 100 points.'
              : p.status === 'rejected'
                ? 'City staff decided not to go ahead with this request.'
                : 'City staff review requests and post their decision here.'}
          </T>
        </View>
      </Section>
    </>
  );
}

function VoteButton({ dir, on, count, c, onPress }: { dir: 1 | -1; on: boolean; count: number; c: Theme; onPress: () => void }) {
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const up = dir === 1;
  const fg = on ? (up ? c.accentFg : c.downFg) : c.text3;
  return (
    <Press haptic onPress={() => { s.value = withSequence(withTiming(1.25, { duration: 120, easing: ease.press }), withTiming(1, { duration: 280, easing: ease.pop })); onPress(); }}
      accessibilityRole="button" accessibilityLabel={up ? `Upvote, ${count}` : `Downvote, ${count}`} accessibilityState={{ selected: on }}
      style={{ flex: up ? 1 : undefined, width: up ? undefined : 96, height: 44, borderRadius: 22, borderWidth: 1, borderColor: on ? (up ? c.upBorder : c.downBorder) : c.line,
        backgroundColor: on ? (up ? c.accentBg : c.downBg) : c.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <Animated.View style={anim}>
        <Icon name={up ? 'up' : 'downVote'} size={18} color={fg} fill={on ? (up ? c.accent : c.down) : 'none'} width={1.8} />
      </Animated.View>
      <T size={15} weight="bold" color={fg} style={{ fontVariant: ['tabular-nums'] }}>{up ? `Upvote · ${count}` : count}</T>
    </Press>
  );
}

function PetitionCard({ p, c, mine, userId, onSigned }: { p: Proposal; c: Theme; mine: boolean; userId: string | null; onSigned: () => void }) {
  const pet = p.petition ?? null;
  const [signed, setSigned] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [floats, setFloats] = useState(0);
  useEffect(() => {
    if (pet && userId) hasSigned(pet.id, userId).then(setSigned).catch(() => setSigned(false));
  }, [pet?.id, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pet) {
    if (!mine) return null;
    return (
      <Section delay={260}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.accentBg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="pen" size={20} color={c.link} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <H2>Petition</H2>
            <T size={13} color={c.text2}>{supabaseEnabled ? 'Gather signatures to show the city how many people want this.' : 'Petitions need Supabase to be connected.'}</T>
          </View>
        </View>
        {supabaseEnabled && <Button title="Start a petition" kind="tonal" height={44} icon="pen" onPress={() => router.push({ pathname: '/petition/[proposalId]', params: { proposalId: p.id } })} />}
      </Section>
    );
  }

  const count = pet.signature_count;
  return (
    <Section delay={260}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.accentBg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="pen" size={20} color={c.link} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <H2>Petition</H2>
          <T size={13} color={c.text2}>{count.toLocaleString()} of {pet.goal.toLocaleString()} signatures{pet.status === 'goal_reached' ? ' · goal reached' : ''}</T>
        </View>
      </View>
      <View accessibilityRole="progressbar" accessibilityLabel="Petition signatures" accessibilityValue={{ min: 0, max: pet.goal, now: count }}>
        <Progress frac={count / pet.goal} />
      </View>
      {pet.reason ? <T size={14} color={c.text3} style={{ lineHeight: 20 }}>{pet.reason}</T> : null}
      {pet.snapshots.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 4, borderRadius: 10, overflow: 'hidden' }}>
          {pet.snapshots.map((u) => (
            <Image key={u} source={{ uri: serverUrl(u) }} style={{ flex: 1, height: 76 }} contentFit="cover" transition={250} accessibilityLabel="Petition snapshot" />
          ))}
        </View>
      )}
      <View>
        <Button
          title={signed ? 'Signed' : 'Sign petition'}
          kind={signed ? 'ok' : 'primary'}
          icon={signed ? 'check' : undefined}
          height={44}
          busy={busy}
          disabled={signed === null || !userId}
          onPress={async () => {
            if (signed || !userId) return;
            setBusy(true);
            setError(null);
            try {
              await sign(pet.id, userId);
              setSigned(true);
              setFloats((n) => n + 1);
              onSigned();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
        {floats > 0 && (
          <View key={floats} pointerEvents="none" style={{ position: 'absolute', right: 24, top: 10 }}>
            <PlusOne c={c} />
          </View>
        )}
      </View>
      {error && <Notice kind="error">{error}</Notice>}
    </Section>
  );
}

/**
 * Shown instead of Street View while the laptop has Gemini build the change into the photos
 * (about a minute after a request is submitted). The bar fills over the usual time, and the view
 * opens by itself when it's done.
 */
function PreparingCover({ c, waiting, onModel }: { c: Theme; waiting: boolean; onModel: () => void }) {
  const [t0] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const TYPICAL = 75_000;
  const el = now - t0;
  const left = Math.max(0, Math.ceil((TYPICAL - el) / 1000));
  if (!waiting) return <Shimmer style={{ flex: 1, borderRadius: 0 }} />;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 14 }}>
      <Pop style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.accentBg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="photo" size={26} color={c.accentFg} />
      </Pop>
      <Rise delay={120} style={{ alignItems: 'center', gap: 6 }}>
        <T size={17} weight="medium" style={{ textAlign: 'center' }}>Making the photo-real view</T>
        <T size={13} color={c.text2} style={{ textAlign: 'center', lineHeight: 19 }}>
          Gemini is building this change into the real Street View photos. It opens here as soon as it’s ready.
        </T>
      </Rise>
      <Rise delay={220} style={{ width: '100%', gap: 6 }}>
        <View accessibilityRole="progressbar" accessibilityLabel="Photo-real view progress">
          <Progress frac={Math.min(0.95, el / TYPICAL)} height={6} delay={0} />
        </View>
        <T size={12} color={c.text2} style={{ textAlign: 'center' }}>
          {left > 0 ? `About ${left} s left` : 'Almost done… Google is busy, so this is taking a little longer.'}
        </T>
      </Rise>
      <Button title="See the 3D model meanwhile" kind="outline" height={40} onPress={onModel} />
    </View>
  );
}

/** "+1 point", floating up after you sign. */
function PlusOne({ c }: { c: Theme }) {
  const y = useSharedValue(0);
  const o = useSharedValue(1);
  useEffect(() => {
    y.value = withTiming(-28, { duration: 1100 });
    o.value = withSequence(withTiming(1, { duration: 700 }), withTiming(0, { duration: 400 }));
  }, [o, y]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }] }));
  return (
    <Animated.View style={anim}>
      <T size={14} weight="bold" color={c.okFg}>+1 point</T>
    </Animated.View>
  );
}
