import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming, ZoomIn } from 'react-native-reanimated';
import { FeedCard } from '@/components/FeedCard';
import { Icon } from '@/components/Icon';
import { BottomBar, Button, H2, Header, Notice, Press, Rise, Section, Shimmer, T } from '@/components/ui';
import type { SnapshotSet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { serverUrl, supabaseEnabled } from '@/lib/config';
import { fetchProposal, startPetition, useApi, useAsync } from '@/lib/data';
import { useSettings } from '@/lib/settings';
import { fonts } from '@/lib/theme';

const KINDS: { kind: string; label: string; photo?: boolean }[] = [
  { kind: 'after', label: 'Street View · after', photo: true },
  { kind: 'closeup', label: 'Close-up', photo: true },
  { kind: 'street', label: 'Down the street' },
  { kind: 'before', label: 'Street View · before' },
  { kind: 'top', label: '3D model · top' },
  { kind: 'angled', label: '3D model · angled' },
];
const GOALS = [100, 250, 500, 1000];

export default function StartPetition() {
  const { proposalId, submitted } = useLocalSearchParams<{ proposalId: string; submitted?: string }>();
  const { colors: c } = useSettings();
  const { userId } = useAuth();
  const api = useApi();
  const req = useAsync(() => fetchProposal(proposalId), [proposalId]);
  const [snaps, setSnaps] = useState<SnapshotSet>({ status: 'none', shots: [] });
  const [picked, setPicked] = useState<string[]>([]);
  const [goal, setGoal] = useState(500);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  // The laptop takes the snapshots while it prepares the request: 3D ones within seconds, Street
  // View ones once the spot nearest the change is photo-real (about half a minute to a minute).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    const poll = async () => {
      const s = await api.snapshots(proposalId).catch(() => null);
      if (s) {
        setSnaps(s);
        // The first two pictures that arrive are picked for you, until you pick yourself.
        setPicked((cur) => (cur.length ? cur : s.shots.slice(0, 2).map((x) => x.kind)));
      }
      if (!s || ((s.status === 'none' || s.status === 'running') && ++tries < 150)) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => clearTimeout(timer);
  }, [api, proposalId]);

  const ready = new Map(snaps.shots.map((s) => [s.kind, s]));
  const finished = snaps.status === 'done' || snaps.status === 'failed';
  const tiles = KINDS.filter((k) => ready.has(k.kind) || !finished);
  const n = picked.length;

  const toggle = (kind: string) => {
    if (!ready.has(kind)) return;
    if (picked.includes(kind)) return setPicked(picked.filter((k) => k !== kind));
    if (n >= 4) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      shake.value = withSequence(withTiming(-6, { duration: 60 }), withTiming(6, { duration: 80 }), withTiming(-4, { duration: 70 }), withTiming(4, { duration: 70 }), withTiming(0, { duration: 60 }));
      return;
    }
    void Haptics.selectionAsync().catch(() => {});
    setPicked([...picked, kind]);
  };
  // Too few pictures could be made (no Street View there, say): the petition goes out without them.
  const noShots = finished && snaps.shots.length < 2;
  const urls = noShots ? [] : picked.map((k) => ready.get(k)?.url).filter((u): u is string => !!u);
  const toRequest = () => router.replace({ pathname: '/request/[id]', params: { id: proposalId } });
  const p = req.data;

  const publish = async () => {
    if (!userId || !p) return;
    setBusy(true);
    setError(null);
    try {
      await startPetition(p.id, userId, goal, reason.trim(), urls);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.dismissAll();
      router.navigate('/feed');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="Start a petition" subtitle={p?.title} onBack={toRequest} backIcon="close"
        right={
          <Press onPress={toRequest} accessibilityRole="button" style={{ height: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center' }}>
            <T size={14} weight="medium" color={c.link}>Skip</T>
          </Press>
        } />
      <ScrollView contentContainerStyle={{ paddingBottom: 140, gap: 8 }} keyboardShouldPersistTaps="handled">
        {submitted === '1' && (
          <Rise delay={80} style={{ marginTop: 12, marginHorizontal: 12 }}>
            <View style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.okBg, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Animated.View entering={ZoomIn.delay(350).springify()} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.okDot, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={16} color={c.onOk} width={3} />
              </Animated.View>
              <T size={14} weight="medium" color={c.okFg} style={{ flex: 1 }}>Request submitted{supabaseEnabled ? ' · +10 points' : ''}</T>
            </View>
          </Rise>
        )}

        {!supabaseEnabled ? (
          <Section delay={150}>
            <Notice>Petitions need Supabase to be connected. Your request is submitted; tap Skip to see it.</Notice>
          </Section>
        ) : (
          <>
            <Section delay={150}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <H2>Pick 2–4 snapshots</H2>
                <Animated.View style={[{ height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: n >= 2 ? c.accentBg : c.waitBg, justifyContent: 'center' }, shakeStyle]} accessibilityLiveRegion="polite">
                  <T size={12} weight="bold" color={n >= 2 ? c.accentFg : c.waitFg}>{n < 2 ? 'Pick at least 2' : `${n} of 4 selected`}</T>
                </Animated.View>
              </View>
              <T size={13} color={c.text2} style={{ lineHeight: 19 }}>
                Choose the views that show the change best. They’re saved as small images and shown on your petition in the Feed, so it loads without the live 3D view.
              </T>
              {!finished && (
                <T size={12} color={c.text2}>The laptop is still making some of these. They appear here as they’re ready{snaps.shots.length ? '' : ' (usually within a minute)'}.</T>
              )}
              {noShots && <Notice>Not enough snapshots could be made for this request, so the petition will be shown without pictures.</Notice>}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, rowGap: 12 }}>
                {tiles.map((k) => {
                  const shot = ready.get(k.kind);
                  const idx = picked.indexOf(k.kind);
                  const on = idx >= 0;
                  return (
                    <Press key={k.kind} onPress={() => toggle(k.kind)} disabled={!shot} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !shot }}
                      accessibilityLabel={`${k.label}${on ? `, selected ${idx + 1} of ${n}` : shot ? '' : ', still being made'}`} style={{ width: '31.4%', gap: 6 }}>
                      <View style={{ height: 86, borderRadius: 12, overflow: 'hidden', borderWidth: on ? 3 : 1, borderColor: on ? c.accent : c.line, transform: [{ scale: on ? 0.95 : 1 }] }}>
                        {shot ? (
                          <Image source={{ uri: serverUrl(shot.url) }} style={{ flex: 1 }} contentFit="cover" transition={300} />
                        ) : (
                          <Shimmer style={{ flex: 1, borderRadius: 0 }} />
                        )}
                        {shot && !on && n >= 4 && <View style={{ position: 'absolute', inset: 0, backgroundColor: c.dark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.35)' }} />}
                        {shot && (on ? (
                          <Animated.View entering={ZoomIn.springify()} style={{ position: 'absolute', left: 6, top: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                            <T size={13} weight="bold" color={c.dark ? c.onPrimary : '#FFFFFF'}>{idx + 1}</T>
                          </Animated.View>
                        ) : (
                          <View style={{ position: 'absolute', left: 6, top: 6, width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.2)' }} />
                        ))}
                      </View>
                      <T size={12} weight={on ? 'bold' : 'regular'} color={on ? c.accentFg : shot ? c.text3 : c.text2} style={{ lineHeight: 15 }}>
                        {shot ? k.label : `${k.label} · making…`}
                      </T>
                    </Press>
                  );
                })}
              </View>
            </Section>

            {p && (
              <Section delay={250}>
                <H2>How it looks in the Feed</H2>
                <FeedCard preview p={{ ...p, petition: { id: 'preview', goal, signature_count: 0, status: 'open', reason, snapshots: urls, created_at: p.created_at } }}
                  my={0} score={p.confirm_count - p.deny_count} onUp={() => {}} onDown={() => {}} shots={urls} />
              </Section>
            )}

            <Section delay={350} style={{ gap: 14 }}>
              <H2>Petition details</H2>
              <View style={{ gap: 8 }}>
                <T size={12} weight="medium" color={c.text2}>Signature goal</T>
                <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
                  {GOALS.map((g) => {
                    const on = g === goal;
                    return (
                      <Press key={g} onPress={() => setGoal(g)} accessibilityRole="radio" accessibilityState={{ checked: on }}
                        style={{ flex: 1, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: on ? 2 : 1, borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accentBg : c.surface }}>
                        <T size={14} weight="medium" color={on ? c.accentFg : c.text3}>{g.toLocaleString()}</T>
                      </Press>
                    );
                  })}
                </View>
              </View>
              <View style={{ gap: 6 }}>
                <T size={12} weight="medium" color={c.text2}>Why should people sign?</T>
                <TextInput value={reason} onChangeText={setReason} multiline maxLength={500} placeholder="One or two sentences people will see on the petition" placeholderTextColor={c.muted} accessibilityLabel="Why should people sign?"
                  style={{ minHeight: 88, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, borderWidth: 1, borderColor: c.line, borderRadius: 10, fontSize: 16, fontFamily: fonts.regular, color: c.text, textAlignVertical: 'top' }} />
              </View>
              {error && <Notice kind="error">{error}</Notice>}
            </Section>
          </>
        )}
      </ScrollView>
      <BottomBar>
        {!supabaseEnabled ? (
          <Button title="See your request" onPress={toRequest} />
        ) : n >= 2 || noShots ? (
          <Button title="Publish petition" icon="pen" busy={busy} onPress={publish} />
        ) : (
          <Button title="Pick at least 2 snapshots" disabled />
        )}
      </BottomBar>
    </KeyboardAvoidingView>
  );
}
