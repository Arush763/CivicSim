import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { dur, ease } from '@/lib/motion';
import Svg, { Circle, G, Path, Polygon, Rect } from 'react-native-svg';
import { Icon, type IconName } from '@/components/Icon';
import { Avatar, Card, Fade, Notice, Press, Rise, Screen, T, TitleBar, Toggle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { updateProfile } from '@/lib/data';
import { useMe } from '@/lib/me';
import { QUALITY_CAPTIONS, QUALITY_NAMES, QUALITY_SPECS, useSettings, type Quality, type ThemeChoice } from '@/lib/settings';
import type { Theme } from '@/lib/theme';

const THEMES: { id: ThemeChoice; label: string; icon: IconName }[] = [
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
  { id: 'system', label: 'System', icon: 'phone' },
];

export default function Settings() {
  return (
    <Screen>
      <SettingsContent />
    </Screen>
  );
}

function SettingsContent() {
  const s = useSettings();
  const c = s.colors;
  const { devMode, userId, signOut } = useAuth();
  const { me, refresh } = useMe();
  const [notify, setNotify] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (me) setNotify(me.notify_updates);
  }, [me]);

  const heading = (text: string, delay: number) => (
    <Rise delay={delay}>
      <T size={13} weight="medium" color={c.text2} style={{ marginTop: 8, marginHorizontal: 4, letterSpacing: 0.3 }} accessibilityRole="header">{text}</T>
    </Rise>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TitleBar title="Settings" />
      <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 32 }}>
        {!devMode && (
          <Rise delay={60}>
            <Press onPress={() => router.navigate('/ranks')} accessibilityRole="button" scaleTo={0.98}
              style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 20, paddingVertical: 14, paddingLeft: 16, paddingRight: 12, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Avatar name={me?.username} size={48} />
              <View style={{ flex: 1, gap: 2 }}>
                <T size={16} weight="medium" numberOfLines={1}>{me?.username ?? '…'}</T>
                <T size={13} color={c.text2}>{me ? `${me.rank} · ${me.points.toLocaleString()} points` : ' '}</T>
              </View>
              <Icon name="chevron" size={20} color={c.text2} />
            </Press>
          </Rise>
        )}

        {heading('APPEARANCE', 120)}
        <Card delay={160}>
          <T size={15} weight="medium">Theme</T>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
            {THEMES.map((t) => {
              const on = t.id === s.theme;
              return (
                <Press key={t.id} onPress={() => s.set({ theme: t.id })} accessibilityRole="radio" accessibilityState={{ checked: on }}
                  style={{ flex: 1, height: 76, borderRadius: 14, borderWidth: on ? 2 : 1, borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accentBg : c.surface, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Icon name={t.icon} size={24} color={on ? c.accentFg : c.text3} />
                  <T size={13} weight="medium" color={on ? c.accentFg : c.text3}>{t.label}</T>
                </Press>
              );
            })}
          </View>
        </Card>

        {heading('MAP & PERFORMANCE', 200)}
        <Card delay={240} style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <T size={15} weight="medium">Map quality</T>
            <Fade key={s.quality}>
              <T size={15} weight="bold" color={c.link}>{QUALITY_NAMES[s.quality]}</T>
            </Fade>
          </View>
          <QualityPreview q={s.quality} c={c} />
          <QualitySlider value={s.quality} onChange={(q) => s.set({ quality: q })} c={c} />
          <T size={13} color={c.text2} style={{ lineHeight: 19 }}>{QUALITY_CAPTIONS[s.quality]}</T>
          <View style={{ borderRadius: 14, backgroundColor: c.inset, paddingVertical: 4, paddingHorizontal: 14 }}>
            {QUALITY_SPECS.map(([label, values], i) => (
              <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 40, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
                <T size={13} color={c.text3}>{label}</T>
                <T size={13} weight="medium" color={values[s.quality] === 'Off' ? c.text2 : c.text}>{values[s.quality]}</T>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T size={15}>Photo-real views</T>
              <T size={12} color={c.text2} style={{ lineHeight: 17 }}>AI-redrawn Street View images, made by the laptop with Gemini. Slower on weak connections.</T>
            </View>
            <Toggle label="Photo-real views" value={s.photoReal} onChange={(v) => s.set({ photoReal: v })} />
          </View>
        </Card>

        {!devMode && (
          <>
            {heading('NOTIFICATIONS', 280)}
            <Card delay={320} style={{ paddingVertical: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T size={15}>Updates on my requests</T>
                  <T size={12} color={c.text2}>City decisions, petition goals, new upvotes</T>
                </View>
                <Toggle
                  label="Updates on my requests"
                  value={notify ?? true}
                  onChange={async (v) => {
                    if (!userId) return;
                    setNotify(v);
                    try {
                      await updateProfile(userId, { notify_updates: v });
                      void refresh();
                    } catch (e) {
                      setNotify(!v);
                      setError((e as Error).message);
                    }
                  }}
                />
              </View>
            </Card>
          </>
        )}
        {error && <Notice kind="error">{error}</Notice>}

        <Card delay={380} style={{ paddingVertical: 4, gap: 0, marginTop: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 }}>
            <T size={15}>Version</T>
            <T size={15} color={c.text2}>{Constants.expoConfig?.version ?? '1.0.0'}</T>
          </View>
          {devMode ? (
            <View style={{ minHeight: 52, justifyContent: 'center', borderTopWidth: 1, borderTopColor: c.border }}>
              <T size={13} color={c.text2}>Local-only mode: Supabase isn’t connected, so there’s no account to sign out of.</T>
            </View>
          ) : (
            <Press onPress={() => { void Haptics.selectionAsync().catch(() => {}); void signOut(); }} accessibilityRole="button" scaleTo={0.98}
              style={{ minHeight: 52, justifyContent: 'center', borderTopWidth: 1, borderTopColor: c.border }}>
              <T size={15} weight="medium" color={c.danger}>Sign out</T>
            </Press>
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

/** A four-step slider (Low → Ultra): drag along it or tap a step. */
function QualitySlider({ value, onChange, c }: { value: Quality; onChange: (q: Quality) => void; c: Theme }) {
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withTiming((value / 3) * Math.max(0, w - 28), { duration: dur.seg, easing: ease.seg });
  }, [value, w, x]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const fill = useAnimatedStyle(() => ({ width: x.value + 14 }));
  const at = (px: number) => {
    const q = Math.round(Math.max(0, Math.min(1, (px - 14) / Math.max(1, w - 28))) * 3) as Quality;
    if (q !== value) {
      void Haptics.selectionAsync().catch(() => {});
      onChange(q);
    }
  };
  return (
    <View style={{ gap: 6 }}>
      <View
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => at(e.nativeEvent.locationX)}
        onResponderMove={(e) => at(e.nativeEvent.locationX)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Map quality"
        accessibilityValue={{ text: QUALITY_NAMES[value] }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onChange(Math.max(0, Math.min(3, value + (e.nativeEvent.actionName === 'increment' ? 1 : -1))) as Quality)}
        style={{ height: 44, justifyContent: 'center' }}
      >
        <View style={{ height: 6, borderRadius: 3, backgroundColor: c.line, overflow: 'hidden' }}>
          <Animated.View style={[{ height: 6, backgroundColor: c.accent }, fill]} />
        </View>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: c.accent, borderWidth: 4, borderColor: c.surface, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3 }, thumb]} />
      </View>
      <View style={{ flexDirection: 'row' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {QUALITY_NAMES.map((n, i) => (
          <T key={n} size={12} weight={i === value ? 'bold' : 'regular'} color={i === value ? c.link : c.text2} style={{ flex: 1, textAlign: i === 0 ? 'left' : i === 3 ? 'right' : 'center' }}>{n}</T>
        ))}
      </View>
    </View>
  );
}

/** A little street that gains 3D buildings, windows, trees and shadows as the quality goes up. */
function QualityPreview({ q, c }: { q: Quality; c: Theme }) {
  const h = q === 0 ? 0.1 : q === 1 ? 0.8 : 1;
  const win = q === 3 ? 1 : q === 2 ? 0.55 : 0;
  const building = (x: number, y: number, w: number, ht: number, windows: [number, number][], ww: number, wh: number, door?: [number, number]) => (
    <G transform={`translate(0 ${96 * (1 - h)}) scale(1 ${h})`}>
      <Polygon points={`${x},${y} ${x + 12},${y - 8} ${x + w + 12},${y - 8} ${x + w},${y}`} fill={c.pTop} />
      <Polygon points={`${x + w},${y} ${x + w + 12},${y - 8} ${x + w + 12},${96 - 8} ${x + w},96`} fill={c.pSide} />
      <Rect x={x} y={y} width={w} height={ht} fill={c.pFront} />
      <G opacity={win}>{windows.map(([wx, wy], i) => <Rect key={i} x={wx} y={wy} width={ww} height={wh} fill={c.pWin} />)}</G>
      {door && <Rect x={door[0]} y={door[1]} width={14} height={18} fill={c.pDoor} />}
    </G>
  );
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`Preview of ${QUALITY_NAMES[q]} map quality`} style={{ height: 118, borderRadius: 14, backgroundColor: c.sky, overflow: 'hidden' }}>
      <Svg width="100%" height={118} viewBox="0 0 300 118" preserveAspectRatio="xMidYMax meet">
        <Rect x={0} y={96} width={300} height={22} fill={c.pGround} />
        <Path d="M0 108 H300" stroke={c.pLane} strokeWidth={2} strokeDasharray="10 8" />
        <G opacity={q >= 2 ? 0.28 : 0} fill={c.pShadow}>
          <Polygon points="30,96 80,96 64,112 14,112" />
          <Polygon points="110,96 170,96 158,108 98,108" />
          <Polygon points="200,96 246,96 226,116 180,116" />
        </G>
        {building(30, 34, 50, 62, [[37, 42], [51, 42], [65, 42], [37, 58], [51, 58], [65, 58], [37, 74], [65, 74]], 8, 8)}
        {building(110, 52, 60, 44, [[118, 60], [135, 60], [152, 60], [118, 76], [152, 76]], 10, 8, [133, 78])}
        {building(200, 20, 46, 76, [[207, 28], [219, 28], [231, 28], [207, 44], [219, 44], [231, 44], [207, 60], [231, 60], [219, 76]], 7, 9)}
        <G opacity={q >= 1 ? 1 : 0}>
          <Rect x={98} y={86} width={3} height={10} fill={c.pTrunk} />
          <Circle cx={99.5} cy={82} r={8} fill={c.pTree} />
          <Rect x={188} y={88} width={3} height={8} fill={c.pTrunk} />
          <Circle cx={189.5} cy={84} r={7} fill={c.pTree} />
          <Rect x={276} y={86} width={3} height={10} fill={c.pTrunk} />
          <Circle cx={277.5} cy={81} r={9} fill={c.pTree} />
        </G>
      </Svg>
      <View style={{ position: 'absolute', right: 8, top: 8, height: 22, paddingHorizontal: 8, borderRadius: 11, backgroundColor: c.surface, justifyContent: 'center' }}>
        <T size={11} weight="bold" color={c.text3}>{q >= 2 ? '60 FPS' : '30 FPS'}</T>
      </View>
    </View>
  );
}
