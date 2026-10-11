import { useContext, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps, type PressableStateCallbackType, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrivalContext, dur, ease, useArrival } from '@/lib/motion';
import { fonts, useIsWide, useTheme } from '@/lib/theme';

// ------------------------------------------------------------------ motion (as in the phone app)
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A pressable that dips a little when pressed and springs back (the design's .95 press). */
export function Press({ style, children, scaleTo = 0.95, ...rest }: Omit<PressableProps, 'style'> & { style?: PressableProps['style']; scaleTo?: number; children?: ReactNode }) {
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  // Animated components drop function styles, so hover and press are worked out here.
  const [state, setState] = useState<PressableStateCallbackType>({ pressed: false, hovered: false });
  return (
    <AnimatedPressable
      {...rest}
      style={[typeof style === 'function' ? style(state) : style, anim]}
      onHoverIn={(e) => {
        setState((x) => ({ ...x, hovered: true }));
        rest.onHoverIn?.(e);
      }}
      onHoverOut={(e) => {
        setState((x) => ({ ...x, hovered: false }));
        rest.onHoverOut?.(e);
      }}
      onPressIn={(e) => {
        setState((x) => ({ ...x, pressed: true }));
        s.value = withTiming(scaleTo, { duration: dur.press, easing: ease.press });
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setState((x) => ({ ...x, pressed: false }));
        s.value = withTiming(1, { duration: dur.release, easing: ease.pop });
        rest.onPressOut?.(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}

/** Rises in when it appears (fades up 18 px); `from` below 0 drops in from above instead. */
export function Rise({ delay = 0, from = 18, style, children }: { delay?: number; from?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const t = useSharedValue(0);
  const arrival = useContext(ArrivalContext);
  useEffect(() => {
    t.value = 0;
    t.value = withDelay(delay, withTiming(1, { duration: from < 0 ? dur.drop : dur.up, easing: ease.out }));
  }, [delay, from, t, arrival]);
  const anim = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ translateY: (1 - t.value) * from }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/** Pops in from small (status chips, badges). */
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

/** A progress bar's fill that grows in from the left (petition signatures, vote share). */
export function Fill({ fraction, color, delay = 200, style }: { fraction: number; color: string; delay?: number; style?: StyleProp<ViewStyle> }) {
  const t = useSharedValue(0);
  const arrival = useContext(ArrivalContext);
  useEffect(() => {
    t.value = 0;
    t.value = withDelay(delay, withTiming(1, { duration: dur.fill, easing: ease.out }));
  }, [delay, t, arrival, fraction]);
  const anim = useAnimatedStyle(() => ({ width: `${Math.max(0, Math.min(1, fraction)) * 100 * t.value}%` }));
  return <Animated.View style={[{ height: '100%', backgroundColor: color }, style, anim]} />;
}

/** A tab screen: its entrance animations play again every time it comes into view. */
export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const arrival = useArrival();
  return (
    <ArrivalContext.Provider value={arrival}>
      <View style={[{ flex: 1 }, style]}>{children}</View>
    </ArrivalContext.Provider>
  );
}

/** Stagger for lists: each item rises a little after the one before (capped, so long lists don't wait). */
export const stagger = (index: number, start = 120) => start + Math.min(index, 10) * 45;

// ------------------------------------------------------------------ cards and text
export function Card({ children, style, delay = 60 }: { children: ReactNode; style?: StyleProp<ViewStyle>; delay?: number }) {
  const t = useTheme();
  return <Rise delay={delay} style={[styles.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</Rise>;
}

/** A card inside a card (request cards in the zone sheet). */
export function InnerCard({ children, style, delay = 60 }: { children: ReactNode; style?: StyleProp<ViewStyle>; delay?: number }) {
  const t = useTheme();
  return <Rise delay={delay} style={[styles.card, { backgroundColor: t.inner, borderColor: t.border }, style]}>{children}</Rise>;
}

export function H1({ children, size = 26, style }: { children: ReactNode; size?: number; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text style={[{ color: t.text, fontFamily: fonts.display, fontSize: size, lineHeight: size * 1.18, letterSpacing: -0.2 }, style]}>{children}</Text>;
}

export function H2({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text style={[{ color: t.text, fontFamily: fonts.displayBold, fontSize: 17 }, style]}>{children}</Text>;
}

/** Small uppercase section label: "1 · What kind of change", "Zone R09·C14". */
export function Label({ children, color, style }: { children: ReactNode; color?: string; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text style={[{ color: color ?? t.muted, fontFamily: fonts.bodyMedium, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' }, style]}>{children}</Text>;
}

/** Numbers (costs, counts): the body font with even-width digits, as in the design. */
export function Mono({ children, size = 14, color, style }: { children: ReactNode; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text style={[{ color: color ?? t.text, fontFamily: fonts.bodyMedium, fontSize: size, fontVariant: ['tabular-nums'] }, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text style={[{ color: t.muted, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 }, style]}>{children}</Text>;
}

export function Body({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text style={[{ color: t.soft, fontFamily: fonts.body, fontSize: 14, lineHeight: 21 }, style]}>{children}</Text>;
}

type ButtonKind = 'primary' | 'secondary' | 'outline' | 'danger' | 'ai' | 'approve';

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  small,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const look: Record<ButtonKind, { bg: string; border: string; fg: string }> = {
    primary: { bg: t.accent, border: t.accent, fg: t.accentText },
    secondary: { bg: t.card, border: t.borderStrong, fg: t.link },
    outline: { bg: 'transparent', border: t.accent, fg: t.link },
    danger: { bg: 'transparent', border: t.danger, fg: t.danger },
    ai: { bg: t.aiTint, border: t.aiTint, fg: t.ai },
    approve: { bg: t.approved, border: t.approved, fg: t.onApproved },
  };
  const l = look[kind];
  return (
    <Press
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ hovered }: { hovered?: boolean }) => [
        styles.button,
        small && styles.small,
        { backgroundColor: l.bg, borderColor: l.border, opacity: disabled ? 0.4 : 1 },
        hovered && !disabled && ({ filter: 'brightness(1.04)' } as object),
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={l.fg} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon}
          <Text style={{ color: l.fg, fontFamily: fonts.bodyMedium, fontSize: small ? 13 : 15 }}>{title}</Text>
        </View>
      )}
    </Press>
  );
}

/** Square 44×44 icon button with a border (zoom, back, close, view-in-3D). */
export function IconButton({ label, onPress, children, tint, style }: { label: string; onPress: () => void; children: ReactNode; tint?: string; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.icon, { borderColor: t.border, backgroundColor: tint ?? t.card }, style]}
    >
      {children}
    </Press>
  );
}

/** Selectable chip/tile. */
export function Chip({ label, onPress, active, color, style }: { label: string; onPress?: () => void; active?: boolean; color?: string; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <Press
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { selected: !!active } : undefined}
      style={[styles.chip, { borderColor: active ? (color ?? 'transparent') : t.borderStrong, backgroundColor: active ? t.forest : t.card }, style]}
    >
      <Text style={{ color: active ? (color ?? t.forestText) : t.soft, fontFamily: fonts.bodyMedium, fontSize: 13, textAlign: 'center' }}>{label}</Text>
    </Press>
  );
}

/** Status chip from the design: a tinted pill with a coloured dot. */
export function Pill({ label, kind = 'waiting' }: { label: string; kind?: 'waiting' | 'review' | 'approved' | 'rejected' | 'ai' | 'neutral' }) {
  const t = useTheme();
  const look = {
    waiting: { bg: t.waitingTint, fg: t.waitingText, dot: t.waiting },
    review: { bg: t.reviewTint, fg: t.reviewText, dot: t.review },
    approved: { bg: t.approvedTint, fg: t.approvedText, dot: t.approved },
    rejected: { bg: t.dangerTint, fg: t.dangerText, dot: t.danger },
    ai: { bg: t.aiTint, fg: t.ai, dot: null },
    neutral: { bg: t.raised, fg: t.soft, dot: null },
  }[kind];
  return (
    <Pop delay={250} style={[styles.pill, { backgroundColor: look.bg }]}>
      {look.dot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: look.dot }} />}
      <Text style={{ color: look.fg, fontFamily: fonts.bodyBold, fontSize: 12 }}>{label}</Text>
    </Pop>
  );
}

/** Small stat box: big mono value, small caption. */
export function Stat({ value, caption, highlight }: { value: string; caption: string; highlight?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: t.inner }]}>
      <Mono size={18} color={highlight ? t.link : t.text}>{value}</Mono>
      <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 12 }}>{caption}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Notice({ children, kind = 'info' }: { children: ReactNode; kind?: 'info' | 'error' }) {
  const t = useTheme();
  return (
    <Rise from={10} style={[styles.notice, { backgroundColor: kind === 'error' ? t.dangerTint : t.forest }]}>
      <Text style={{ color: kind === 'error' ? t.dangerText : t.forestText, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </Rise>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 10 },
  button: { borderRadius: 22, borderWidth: 1, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  small: { borderRadius: 17, paddingHorizontal: 14, minHeight: 34 },
  icon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chip: { borderWidth: 1, borderRadius: 17, paddingHorizontal: 14, minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  pill: { borderRadius: 13, height: 26, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  stat: { flex: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
  notice: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
});

/** Page title for list screens: mono kicker over a display title, clear of the status bar. */
export function PageHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  return (
    <Rise style={{ paddingTop: wide ? 8 : insets.top + 10, paddingBottom: 6, gap: 4 }}>
      <H1 size={28}>{title}</H1>
      <Text style={{ color: useTheme().muted, fontFamily: fonts.body, fontSize: 14 }}>{kicker.charAt(0) + kicker.slice(1).toLowerCase()}</Text>
      {children}
    </Rise>
  );
}

/** Content column for list screens: full width on phones, centred and capped on desktop. */
export const pageColumn = { paddingHorizontal: 28, paddingTop: 24, paddingBottom: 40, gap: 18, width: '100%', maxWidth: 1080, alignSelf: 'center' } as const;
