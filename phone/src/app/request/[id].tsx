import { changeFocus, describeRequest, type AreaDetail } from '@mamdani/shared';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Share, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { Avatar, Button, H2, IconButton, Notice, Pill, Press, Progress, Section, Segmented, Shimmer, T } from '@/components/ui';
import { WebPane, type WebPaneHandle } from '@/components/WebPane';
import { useAuth } from '@/lib/auth';
import { serverUrl, supabaseEnabled } from '@/lib/config';
import { fetchProposal, hasSigned, sign, useApi, useAsync, useVoting, type Proposal } from '@/lib/data';
import { ago, costRange, money, opKinds, STATUS_LONG, statusColors } from '@/lib/format';
import { modelUrl, streetViewUrl } from '@/lib/streetview';
import { ease } from '@/lib/motion';
import { useSettings } from '@/lib/settings';
import type { Theme } from '@/lib/theme';

type Mode = 'before' | 'compare' | 'after';

export default function RequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors: c, quality, photoReal, set } = useSettings();
  const { userId, session } = useAuth();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const req = useAsync(() => fetchProposal(id), [id]);
  const p = req.data;
  const [area, setArea] = useState<AreaDetail | null>(null);
  const [view, setView] = useState<'sv' | '3d'>('sv');
  const [mode, setMode] = useState<Mode>('compare');
  const [full, setFull] = useState(false);
  const [svProblem, setSvProblem] = useState<string | null>(null);
  const [photoOn, setPhotoOn] = useState(false);
  const [prep, setPrep] = useState<string>('none');
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
    api.area(p.area_id).then(setArea).catch(() => {});
  }, [api, p?.area_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // How far along the laptop is with this request's photo-real views (it starts when it's submitted).
  useEffect(() => {
    if (!p) return;
    let timer: ReturnType<typeof setTimeout>;
    let last = '';
    const poll = async () => {
      const s = supabaseEnabled ? (await fetchProposal(id).catch(() => null))?.photo_status ?? 'none' : (await api.prerender(id).catch(() => null))?.status ?? 'none';
      if (last && last !== 'done' && s === 'done') setReload((n) => n + 1); // ready now: load the prepared views
      last = s;
      setPrep(s);
      if (s === 'queued' || s === 'running') timer = setTimeout(poll, 8000);
    };
    void poll();
    return () => clearTimeout(timer);
  }, [api, id, p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const focus = useMemo(() => (p && area ? changeFocus(p.ops, area.scene) : null), [p, area]);
  // Built once per request (switching Before/After talks to the page instead of reloading it).
  const startMode = useRef<Mode>('compare');
  const svUri = useMemo(
    () => (p && area && focus ? streetViewUrl(p.after_url, focus, p.ops, describeRequest(p.ops, area.scene), { token: session?.access_token ?? null, photo: photoReal, mode: startMode.current }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p?.id, area?.id, focus?.at.join(','), photoReal, session?.user.id],
  );
  const mUri = useMemo(() => (p ? modelUrl(p.after_url, focus?.at ?? null, quality, c.dark) : null), [p?.after_url, focus, quality, c.dark]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const photoLabel = !photoReal ? 'Photo-real off' : prep === 'queued' || prep === 'running' ? 'Preparing…' : 'Photo-real';

  const hero = (
    <View style={{ height: heroH, backgroundColor: c.stage }}>
      {!p || !area ? (
        <Shimmer style={{ flex: 1, borderRadius: 0 }} />
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

      {view === 'sv' && svUri && !svProblem && (
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
          <Segmented label="Preview type" height={34} style={{ width: 214 }} value={view} onChange={setView}
            options={[{ id: 'sv', label: 'Street View' }, { id: '3d', label: '3D model' }]} />
          <Press onPress={() => set({ photoReal: !photoReal })} accessibilityRole="switch" accessibilityState={{ checked: photoReal }} accessibilityLabel="Photo-real views"
            style={{ height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: photoReal ? c.upBorder : c.line, backgroundColor: photoReal ? c.accentBg : c.surface, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {photoReal && (prep === 'done' || photoOn) && <Icon name="check" size={14} color={c.accentFg} width={2.6} />}
            <T size={13} weight="medium" color={photoReal ? c.accentFg : c.text3}>{photoLabel}</T>
          </Press>
        </View>
        {p && <Details p={p} c={c} voting={voting} userId={userId} onSigned={() => req.refresh()} />}
      </ScrollView>
    </View>
  );
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
        {p.cost.items.map((it, i) => (
          <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border }}>
            <T size={14} color={c.text3} style={{ flex: 1 }}>{it.label}</T>
            <T size={14} weight="medium" style={{ fontVariant: ['tabular-nums'] }}>{money(it.total)}</T>
          </View>
        ))}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border }}>
          <T size={14} color={c.text3}>Contingency (20%)</T>
          <T size={14} weight="medium" style={{ fontVariant: ['tabular-nums'] }}>{money(p.cost.contingency)}</T>
        </View>
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
