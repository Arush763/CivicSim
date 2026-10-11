import * as Haptics from 'expo-haptics';
import { useContext, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/settings';
import { ArrivalContext, dur, ease, useArrival } from '@/lib/motion';
import { fonts } from '@/lib/theme';
import { Icon, type IconName } from './Icon';

// ------------------------------------------------------------------ text
type Weight = 'regular' | 'medium' | 'bold';
/**
 * Text in Google Sans. Line height is the font's own unless a style sets one, as in the design's
 * CSS; Android's extra padding above and below text is turned off so labels sit centred in pills
 * and buttons on both platforms.
 */
export function T({ size = 14, weight = 'regular', color, style, ...rest }: TextProps & { size?: number; weight?: Weight; color?: string }) {
  const c = useTheme();
  return <Text {...rest} style={[{ fontFamily: fonts[weight], fontSize: size, color: color ?? c.text, includeFontPadding: false }, style]} />;
}

// ------------------------------------------------------------------ pressing
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A pressable that dips a little when pressed, like the design's buttons (scale .95, then back
 * with a slight overshoot). Its style is the button's own layout: flex, size, row direction.
 */
export function Press({ style, children, scaleTo = 0.95, haptic = false, onPress, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; scaleTo?: number; haptic?: boolean; children?: ReactNode }) {
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      style={[style, anim]}
      onPress={(e) => {
        if (haptic) void Haptics.selectionAsync().catch(() => {});
        onPress?.(e);
      }}
      onPressIn={(e) => {
        s.value = withTiming(scaleTo, { duration: dur.press, easing: ease.press });
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.value = withTiming(1, { duration: dur.release, easing: ease.pop });
        rest.onPressOut?.(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}

/**
 * Content that rises in when it first appears: fades up 18 px over .65 s on the design's ease-out
 * (its "cs-up"). `from` -16 drops in from above instead (headers, "cs-drop").
 */
export function Rise({ delay = 0, from = 18, style, children, pointerEvents }: { delay?: number; from?: number; style?: StyleProp<ViewStyle>; children: ReactNode; pointerEvents?: 'box-none' | 'none' | 'auto' }) {
  const t = useSharedValue(0);
  const arrival = useContext(ArrivalContext);
  useEffect(() => {
    t.value = 0;
    t.value = withDelay(delay, withTiming(1, { duration: from < 0 ? dur.drop : dur.up, easing: ease.out }));
  }, [delay, from, t, arrival]);
  const anim = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ translateY: (1 - t.value) * from }] }));
  return <Animated.View style={[style, anim]} pointerEvents={pointerEvents}>{children}</Animated.View>;
}

/** Fades in when it appears (give it a new key to fade in again, e.g. when a value changes). */
export function Fade({ duration = 250, style, children }: { duration?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const t = useSharedValue(0);
  const arrival = useContext(ArrivalContext);
  useEffect(() => {
    t.value = 0;
    t.value = withTiming(1, { duration, easing: ease.out });
  }, [duration, t, arrival]);
  const anim = useAnimatedStyle(() => ({ opacity: t.value }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/** Pops in from small (badges, ticks, the design's "cs-pop"). */
export function Pop({ delay = 0, style, children }: { delay?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const t = useSharedValue(0);
  const arrival = useContext(ArrivalContext);
  useEffect(() => {
    t.value = 0;
    t.value = withDelay(delay, withTiming(1, { duration: dur.pop, easing: ease.pop }));
  }, [delay, t, arrival]);
  const anim = useAnimatedStyle(() => ({ opacity: Math.min(1, t.value * 1.5), transform: [{ scale: 0.3 + 0.7 * t.value }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/**
 * A screen: plays its entrance animations again every time it comes into view (tabs, and coming
 * back to it), the way the design's pages do.
 */
export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const arrival = useArrival();
  return (
    <ArrivalContext.Provider value={arrival}>
      <View style={[{ flex: 1 }, style]}>{children}</View>
    </ArrivalContext.Provider>
  );
}

/** A map settling into place: zooms out from 1.25× and brightens over 1.4 s (the design's "cs-mapin"). */
export function MapIn({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const t = useSharedValue(0);
  const arrival = useContext(ArrivalContext);
  useEffect(() => {
    t.value = 0;
    t.value = withTiming(1, { duration: 1400, easing: ease.out });
  }, [t, arrival]);
  const anim = useAnimatedStyle(() => ({ opacity: 0.4 + 0.6 * t.value, transform: [{ scale: 1.25 - 0.25 * t.value }] }));
  return <Animated.View style={[{ overflow: 'hidden' }, style]}><Animated.View style={[{ flex: 1 }, anim]}>{children}</Animated.View></Animated.View>;
}

/** Slides up from below its own height (the design's bottom bars and sheets: "cs-rise", "cs-sheet"). */
export function RiseUp({ delay = 400, duration = 700, style, children }: { delay?: number; duration?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const t = useSharedValue(0);
  const h = useSharedValue(400);
  const arrival = useContext(ArrivalContext);
  useEffect(() => {
    t.value = 0;
    t.value = withDelay(delay, withTiming(1, { duration, easing: ease.out }));
  }, [delay, duration, t, arrival]);
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - t.value) * h.value }] }));
  return (
    <Animated.View style={[style, anim]} onLayout={(e) => (h.value = e.nativeEvent.layout.height + 8)}>
      {children}
    </Animated.View>
  );
}

// ------------------------------------------------------------------ buttons
export function Button({ title, onPress, kind = 'primary', icon, busy, disabled, height = 48, style }: {
  title: string;
  onPress?: () => void;
  kind?: 'primary' | 'outline' | 'tonal' | 'ok';
  icon?: IconName;
  busy?: boolean;
  disabled?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const off = disabled || busy;
  const look = {
    primary: { bg: c.primary, fg: c.onPrimary, border: 'transparent' },
    outline: { bg: c.surface, fg: c.link, border: c.line },
    tonal: { bg: c.accentBg, fg: c.accentFg, border: 'transparent' },
    ok: { bg: c.okBg, fg: c.okFg, border: 'transparent' },
  }[kind];
  const bg = disabled ? c.disabledBg : look.bg;
  const fg = disabled ? c.disabledFg : look.fg;
  return (
    <Press
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={[
        styles.button,
        { height, borderRadius: height / 2, backgroundColor: bg, borderColor: disabled ? 'transparent' : look.border, borderWidth: kind === 'outline' ? 1 : 0 },
        kind === 'primary' && !disabled && { shadowColor: c.primary, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={18} color={fg} width={2.2} /> : null}
      <T size={height >= 48 ? 16 : 15} weight="medium" color={fg}>{title}</T>
    </Press>
  );
}

/** A round icon button (44 px). */
export function IconButton({ icon, label, onPress, color, bg = 'transparent', size = 44, iconSize = 22, style, elevated }: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  color?: string;
  bg?: string;
  size?: number;
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
}) {
  const c = useTheme();
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, elevated && shadow(c), style]}>
      <Icon name={icon} size={iconSize} color={color ?? c.text3} />
    </Press>
  );
}

export const shadow = (c: { shadow: string }) => ({ shadowColor: '#000', shadowOpacity: c.shadow.includes('0.5') ? 0.5 : 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 });

// ------------------------------------------------------------------ chips and pills
export function Pill({ label, bg, fg, dot, height = 24, style, icon }: { label: string; bg: string; fg: string; dot?: string; height?: number; style?: StyleProp<ViewStyle>; icon?: IconName }) {
  return (
    <View style={[{ height, paddingHorizontal: 10, borderRadius: height / 2, backgroundColor: bg, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }, style]}>
      {dot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} />}
      {icon && <Icon name={icon} size={14} color={fg} />}
      <T size={12} weight="medium" color={fg} numberOfLines={1}>{label}</T>
    </View>
  );
}

// ------------------------------------------------------------------ segmented control
/**
 * A segmented switch with a sliding thumb. `look`: 'soft' (on a grey track), 'outline' (with a
 * border, in forms), or 'dark' (over a photo).
 */
export function Segmented<K extends string>({ options, value, onChange, look = 'soft', height = 38, style, label }: {
  options: { id: K; label: string }[];
  value: K;
  onChange: (id: K) => void;
  look?: 'soft' | 'outline' | 'dark';
  height?: number;
  style?: StyleProp<ViewStyle>;
  label?: string;
}) {
  const c = useTheme();
  const [w, setW] = useState(0);
  const idx = Math.max(0, options.findIndex((o) => o.id === value));
  const seg = w ? (w - 6) / options.length : 0;
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withTiming(idx * seg, { duration: dur.seg, easing: ease.seg });
  }, [idx, seg, x]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const track = look === 'dark' ? 'rgba(32,33,36,0.82)' : look === 'outline' ? c.inset : c.seg;
  const thumbBg = look === 'dark' ? '#FFFFFF' : look === 'outline' ? c.accentBg : c.raised;
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[{ flexDirection: 'row', padding: 3, borderRadius: (height + 6) / 2, backgroundColor: track, borderWidth: look === 'outline' ? 1 : 0, borderColor: c.line }, style]}
    >
      {seg > 0 && <Animated.View style={[{ position: 'absolute', left: 3, top: 3, width: seg, height, borderRadius: height / 2, backgroundColor: thumbBg, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 }, thumb]} />}
      {options.map((o) => {
        const on = o.id === value;
        const fg = look === 'dark' ? (on ? '#202124' : '#FFFFFF') : on ? (look === 'outline' ? c.accentFg : c.text) : look === 'outline' ? c.text3 : c.text2;
        return (
          <Pressable key={o.id} onPress={() => o.id !== value && onChange(o.id)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ flex: 1, height, alignItems: 'center', justifyContent: 'center' }}>
            <T size={look === 'dark' ? 14 : 14} weight="medium" color={fg}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ switch
export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const c = useTheme();
  const x = useSharedValue(value ? 20 : 0);
  useEffect(() => {
    x.value = withTiming(value ? 20 : 0, { duration: 250, easing: ease.seg });
  }, [value, x]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }}
      style={{ width: 52, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 48, height: 28, borderRadius: 14, padding: 3, backgroundColor: value ? c.accent : c.off }}>
        <Animated.View style={[{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 }, knob]} />
      </View>
    </Pressable>
  );
}

// ------------------------------------------------------------------ stepper
export function Stepper({ label, value, onChange, min, max, step = 1, suffix = '' }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  const c = useTheme();
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 100) / 100));
  const btn = (sign: 1 | -1) => (
    <Press onPress={() => onChange(clamp(value + sign * step))} accessibilityRole="button" accessibilityLabel={`${sign > 0 ? 'More' : 'Fewer'} ${label.toLowerCase()}`}
      style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={sign > 0 ? 'plus' : 'close'} size={16} color={c.text3} />
    </Press>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
      <T size={14} style={{ flex: 1 }}>{label}</T>
      {btn(-1)}
      <T size={15} weight="medium" style={{ minWidth: 56, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{value}{suffix}</T>
      {btn(1)}
    </View>
  );
}

// ------------------------------------------------------------------ votes
/** Up arrow, score, down arrow (Feed and zone lists). */
export function VoteColumn({ my, score, onUp, onDown, size = 20, width = 48 }: { my: number; score: number; onUp: () => void; onDown: () => void; size?: number; width?: number }) {
  const c = useTheme();
  const bump = useSharedValue(1);
  const pop = () => {
    bump.value = withSequence(withTiming(1.25, { duration: 120, easing: ease.press }), withTiming(1, { duration: 280, easing: ease.pop }));
  };
  const scoreAnim = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }));
  const arrow = (dir: 1 | -1) => {
    const on = my === dir;
    const tint = dir === 1 ? c.accent : c.down;
    return (
      <Press
        haptic
        onPress={() => {
          pop();
          (dir === 1 ? onUp : onDown)();
        }}
        accessibilityRole="button"
        accessibilityLabel={dir === 1 ? 'Upvote' : 'Downvote'}
        accessibilityState={{ selected: on }}
        scaleTo={0.85}
        style={{ width: 44, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? (dir === 1 ? c.accentBg : c.downBg) : 'transparent' }}
      >
        <Icon name={dir === 1 ? 'up' : 'downVote'} size={size} color={on ? tint : c.idle} fill={on ? tint : 'none'} width={1.8} />
      </Press>
    );
  };
  return (
    <View style={{ width, alignItems: 'center' }}>
      {arrow(1)}
      <Animated.View style={scoreAnim}>
        <T size={15} weight="bold" color={my === 1 ? c.link : my === -1 ? c.down : c.text} style={{ fontVariant: ['tabular-nums'], paddingVertical: 1 }}>{score}</T>
      </Animated.View>
      {arrow(-1)}
    </View>
  );
}

// ------------------------------------------------------------------ progress, loading
export function Progress({ frac, color, track, height = 8, delay = 200 }: { frac: number; color?: string; track?: string; height?: number; delay?: number }) {
  const c = useTheme();
  const w = useSharedValue(0);
  useEffect(() => {
    const t = setTimeout(() => (w.value = withTiming(Math.max(0, Math.min(1, frac)), { duration: dur.fill, easing: ease.out })), delay);
    return () => clearTimeout(t);
  }, [frac, delay, w]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: track ?? c.track, overflow: 'hidden' }}>
      <Animated.View style={[{ height, borderRadius: height / 2, backgroundColor: color ?? c.accent }, fill]} />
    </View>
  );
}

/** A soft pulsing placeholder while something loads. */
export function Shimmer({ style }: { style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  const o = useSharedValue(0.5);
  useEffect(() => {
    o.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [o]);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ backgroundColor: c.track, borderRadius: 12 }, style, a]} />;
}

export function Notice({ children, kind = 'info', style }: { children: ReactNode; kind?: 'info' | 'error' | 'ok'; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  const [bg, fg] = kind === 'error' ? [c.badBg, c.badFg] : kind === 'ok' ? [c.okBg, c.okFg] : [c.accentBg, c.accentFg];
  return (
    <View style={[{ backgroundColor: bg, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 }, style]}>
      <T size={14} color={fg}>{children}</T>
    </View>
  );
}

// ------------------------------------------------------------------ layout
/** A full-width white section on the grey page (the design's request and zone screens). */
export function Section({ children, style, delay = 0 }: { children: ReactNode; style?: StyleProp<ViewStyle>; delay?: number }) {
  const c = useTheme();
  return (
    <Rise delay={delay}>
      <View style={[{ backgroundColor: c.surface, padding: 16, gap: 12 }, style]}>{children}</View>
    </Rise>
  );
}

/** A rounded card (Ranks and Settings). */
export function Card({ children, style, delay = 0 }: { children: ReactNode; style?: StyleProp<ViewStyle>; delay?: number }) {
  const c = useTheme();
  return (
    <Rise delay={delay}>
      <View style={[{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 20, padding: 16, gap: 12 }, style]}>{children}</View>
    </Rise>
  );
}

export function H2({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <T size={16} weight="medium" accessibilityRole="header" style={style}>{children}</T>;
}

/** A sub-screen header: back/close, title and subtitle, an optional action on the right. */
export function Header({ title, subtitle, onBack, backIcon = 'back', right }: { title: string; subtitle?: string; onBack: () => void; backIcon?: IconName; right?: ReactNode }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Rise from={-16} style={{ zIndex: 2 }}>
    <View style={{ paddingTop: insets.top + 4, paddingBottom: 4, paddingLeft: 4, paddingRight: 8, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <IconButton icon={backIcon} label={backIcon === 'close' ? 'Close' : 'Back'} onPress={onBack} size={48} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T size={18} weight="medium" numberOfLines={1} accessibilityRole="header">{title}</T>
        {subtitle ? <T size={12} color={c.text2} numberOfLines={1}>{subtitle}</T> : null}
      </View>
      {right}
    </View>
    </Rise>
  );
}

/** A tab's big title bar (Feed, Ranks, Settings). */
export function TitleBar({ title, right, children }: { title: string; right?: ReactNode; children?: ReactNode }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Rise from={-16} style={{ zIndex: 2 }}>
    <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 16, paddingBottom: children ? 0 : 10, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 48 }}>
        <T size={26} weight="bold" style={{ flex: 1, letterSpacing: -0.2, lineHeight: 32 }} accessibilityRole="header">{title}</T>
        {right}
      </View>
      {children}
    </View>
    </Rise>
  );
}

/** The bar pinned to the bottom of a form screen (cost and Submit, Publish…). */
export function BottomBar({ children }: { children: ReactNode }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <RiseUp style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
      <View style={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: Math.max(16, insets.bottom + 8), backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border, gap: 12 }}>{children}</View>
    </RiseUp>
  );
}

export function Avatar({ name, size = 36, bg, fg }: { name: string | null | undefined; size?: number; bg?: string; fg?: string }) {
  const c = useTheme();
  const letters = (name ?? '?').replace(/[^a-zA-Z0-9 ._-]/g, '').split(/[ ._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg ?? c.primary, alignItems: 'center', justifyContent: 'center' }}>
      <T size={Math.round(size * 0.38)} weight="medium" color={fg ?? c.onPrimary}>{letters.slice(0, 2)}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
});
