import { Image } from 'expo-image';
import { router } from 'expo-router';
import { View } from 'react-native';
import { serverUrl } from '@/lib/config';
import type { Proposal } from '@/lib/data';
import { ago, costRange, STATUS_SHORT, statusColors } from '@/lib/format';
import { kindIcon } from '@/lib/ops';
import { useSettings } from '@/lib/settings';
import { Icon } from './Icon';
import { Pill, Press, T, VoteColumn } from './ui';

/**
 * A request in the Feed: votes on the left; zone, title, status, the petition's snapshots (small
 * still images, so the Feed never loads a live view) and cost on the right.
 */
export function FeedCard({ p, my, score, onUp, onDown, shots, preview = false }: {
  p: Proposal;
  my: number;
  score: number;
  onUp: () => void;
  onDown: () => void;
  /** Snapshot URLs to show (the petition's, or the ones being picked). */
  shots?: string[];
  /** A preview (Start a petition): nothing opens. */
  preview?: boolean;
}) {
  const { colors: c } = useSettings();
  const st = statusColors(p.status, c);
  const pics = shots ?? p.petition?.snapshots ?? [];
  const petition = p.petition ? `${p.petition.signature_count.toLocaleString()} / ${p.petition.goal.toLocaleString()} signed` : null;
  const green = p.ops[0]?.type === 'plant_trees' || p.ops[0]?.type === 'add_park' || p.ops[0]?.type === 'add_bike_lane';

  return (
    <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 16, paddingVertical: 12, paddingRight: 12, paddingLeft: 4, flexDirection: 'row', gap: 6 }}>
      <VoteColumn my={my} score={score} onUp={onUp} onDown={onDown} />
      <Press disabled={preview} scaleTo={0.98} accessibilityRole={preview ? undefined : 'button'} onPress={() => router.push({ pathname: '/request/[id]', params: { id: p.id } })}
        style={{ flex: 1, minWidth: 0, flexDirection: 'row', gap: 12, paddingTop: 4 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <T size={12} color={c.text2} numberOfLines={1}>{p.area_name ?? 'Zone'} · {ago(p.created_at, true)}</T>
          <T size={16} weight="medium" style={{ lineHeight: 21 }}>{p.title}</T>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Pill label={STATUS_SHORT[p.status]} bg={st.bg} fg={st.fg} height={22} />
            {p.source === 'ai_suggested' && <Pill label="AI suggested" bg={c.aiBg} fg={c.aiFg} height={22} />}
          </View>
          {pics.length > 0 && (
            <View accessibilityLabel="Petition snapshots" style={{ flexDirection: 'row', gap: 4, borderRadius: 10, overflow: 'hidden', marginTop: 2, minHeight: 76, backgroundColor: c.inset }}>
              {pics.map((u) => (
                <Image key={u} source={{ uri: serverUrl(u) }} style={{ flex: 1, height: pics.length >= 3 ? 76 : 90 }} contentFit="cover" transition={250} />
              ))}
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            <T size={13} color={c.text3} style={{ fontVariant: ['tabular-nums'] }}>{costRange(p.cost)}</T>
            {petition && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="pen" size={14} color={c.link} />
                <T size={13} weight="medium" color={c.link}>{petition}</T>
              </View>
            )}
          </View>
        </View>
        {pics.length === 0 && (
          <View style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: green ? c.okBg : c.accentBg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={kindIcon(p.ops)} size={28} color={green ? c.okDot : c.link} width={1.8} />
          </View>
        )}
      </Press>
    </View>
  );
}
