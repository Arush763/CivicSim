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

export function Mono({ children, size = 14, color, style }: { children: ReactNode; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text style={[{ color: color ?? t.text, fontFamily: fonts.monoMedium, fontSize: size }, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text style={[{ color: t.muted, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 }, style]}>{children}</Text>;
}

export function Body({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text style={[{ color: t.soft, fontFamily: fonts.body, fontSize: 14, lineHeight: 21 }, style]}>{children}</Text>;
}

type ButtonKind = 'primary' | 'secondary' | 'outline' | 'danger' | 'ai';

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
    secondary: { bg: 'transparent', border: t.borderStrong, fg: t.text },
    outline: { bg: 'transparent', border: t.accent, fg: t.accent },
    danger: { bg: 'transparent', border: t.danger, fg: t.danger },
    ai: { bg: 'transparent', border: t.aiLine, fg: t.ai },
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
          <Text style={{ color: l.fg, fontFamily: small ? fonts.bodySemi : fonts.bodyBold, fontSize: small ? 14 : 16 }}>{title}</Text>
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
  const c = color ?? t.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { selected: !!active } : undefined}
      style={[styles.chip, { borderColor: active ? c : t.border, backgroundColor: active ? t.forest : t.card }, style]}
    >
      <Text style={{ color: active ? c : t.text, fontFamily: fonts.bodySemi, fontSize: 13, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

/** Status pill: waiting (forest), approved (solid green), rejected (dashed), AI. */
export function Pill({ label, kind = 'waiting' }: { label: string; kind?: 'waiting' | 'approved' | 'rejected' | 'ai' | 'neutral' }) {
  const t = useTheme();
  const look = {
    waiting: { bg: t.waitingTint, border: t.waitingLine, fg: '#B06000', dashed: false },
    approved: { bg: t.approvedTint, border: '#A8DAB5', fg: '#137333', dashed: false },
    rejected: { bg: t.raised, border: t.border, fg: t.muted, dashed: true },
    ai: { bg: 'transparent', border: t.aiLine, fg: t.ai, dashed: false },
    neutral: { bg: 'transparent', border: t.border, fg: t.muted, dashed: false },
  }[kind];
  return (
    <View style={[styles.pill, { backgroundColor: look.bg, borderColor: look.border, borderStyle: look.dashed ? 'dashed' : 'solid' }]}>
      <Text style={{ color: look.fg, fontFamily: fonts.bodySemi, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

/** Small stat box: big mono value, small caption. */
export function Stat({ value, caption, highlight }: { value: string; caption: string; highlight?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: highlight ? t.forest : t.inner, borderColor: highlight ? t.forestLine : t.border }]}>
      <Mono size={18} color={highlight ? t.accent : t.text}>{value}</Mono>
      <Text style={{ color: highlight ? t.accent : t.muted, fontFamily: fonts.body, fontSize: 11 }}>{caption}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Notice({ children, kind = 'info' }: { children: ReactNode; kind?: 'info' | 'error' }) {
  const t = useTheme();
  const c = kind === 'error' ? t.danger : t.forestLine;
  return (
    <View style={[styles.notice, { borderColor: c, backgroundColor: kind === 'error' ? '#FCE8E6' : t.forest }]}>
      <Text style={{ color: kind === 'error' ? '#A50E0E' : t.soft, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 10 },
  button: { borderRadius: 24, borderWidth: 1, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  small: { borderRadius: 20, paddingHorizontal: 14, minHeight: 40 },
  icon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 8, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  stat: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
  notice: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
});

/** Page title for list screens: mono kicker over a display title, clear of the status bar. */
export function PageHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  return (
    <View style={{ paddingTop: wide ? 16 : insets.top + 10, paddingBottom: 6, gap: 6 }}>
      <Label color={useTheme().muted}>{kicker}</Label>
      <H1 size={wide ? 32 : 28}>{title}</H1>
      {children}
    </View>
  );
}

/** Content column for list screens: full width on phones, centred and capped on desktop. */
export const pageColumn = { padding: 20, gap: 12, width: '100%', maxWidth: 880, alignSelf: 'center' } as const;
