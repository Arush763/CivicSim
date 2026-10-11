import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, useIsWide, useTheme } from '@/lib/theme';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</View>;
}

/** A card inside a card (request cards in the zone sheet). */
export function InnerCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.inner, borderColor: t.border }, style]}>{children}</View>;
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
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        small && styles.small,
        { backgroundColor: l.bg, borderColor: l.border, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
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
    </Pressable>
  );
}

/** Square 44×44 icon button with a border (zoom, back, close, view-in-3D). */
export function IconButton({ label, onPress, children, tint, style }: { label: string; onPress: () => void; children: ReactNode; tint?: string; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.icon, { borderColor: t.border, backgroundColor: tint ?? t.card, opacity: pressed ? 0.8 : 1 }, style]}
    >
      {children}
    </Pressable>
  );
}

/** Selectable chip/tile. */
export function Chip({ label, onPress, active, color, style }: { label: string; onPress?: () => void; active?: boolean; color?: string; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { selected: !!active } : undefined}
      style={[styles.chip, { borderColor: active ? (color ?? 'transparent') : t.borderStrong, backgroundColor: active ? t.forest : t.card }, style]}
    >
      <Text style={{ color: active ? (color ?? t.forestText) : t.soft, fontFamily: fonts.bodyMedium, fontSize: 13, textAlign: 'center' }}>{label}</Text>
    </Pressable>
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
    <View style={[styles.pill, { backgroundColor: look.bg }]}>
      {look.dot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: look.dot }} />}
      <Text style={{ color: look.fg, fontFamily: fonts.bodyBold, fontSize: 12 }}>{label}</Text>
    </View>
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
    <View style={[styles.notice, { backgroundColor: kind === 'error' ? t.dangerTint : t.forest }]}>
      <Text style={{ color: kind === 'error' ? t.dangerText : t.forestText, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
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
    <View style={{ paddingTop: wide ? 8 : insets.top + 10, paddingBottom: 6, gap: 4 }}>
      <H1 size={28}>{title}</H1>
      <Text style={{ color: useTheme().muted, fontFamily: fonts.body, fontSize: 14 }}>{kicker.charAt(0) + kicker.slice(1).toLowerCase()}</Text>
      {children}
    </View>
  );
}

/** Content column for list screens: full width on phones, centred and capped on desktop. */
export const pageColumn = { paddingHorizontal: 28, paddingTop: 24, paddingBottom: 40, gap: 18, width: '100%', maxWidth: 1080, alignSelf: 'center' } as const;
