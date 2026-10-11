import { router } from 'expo-router';
import { View } from 'react-native';
import type { Proposal } from '@/lib/data';
import { ago, costRange, STATUS_SHORT, statusColors } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { Pill, Press, T, VoteColumn } from './ui';

/** A request in a list: votes on the left, title and status on the right. */
export function RequestRow({ p, my, score, onUp, onDown }: { p: Proposal; my: number; score: number; onUp: () => void; onDown: () => void }) {
  const { colors: c } = useSettings();
  const st = statusColors(p.status, c);
  return (
    <View style={{ flexDirection: 'row', gap: 8, paddingTop: 10, paddingBottom: 12, paddingLeft: 8, paddingRight: 16, borderTopWidth: 1, borderTopColor: c.border }}>
      <VoteColumn my={my} score={score} onUp={onUp} onDown={onDown} size={18} width={44} />
      <Press scaleTo={0.98} onPress={() => router.push({ pathname: '/request/[id]', params: { id: p.id } })} accessibilityRole="button" style={{ flex: 1, gap: 6, paddingTop: 6 }}>
        <T size={15} weight="medium">{p.title}</T>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Pill label={STATUS_SHORT[p.status]} bg={st.bg} fg={st.fg} height={22} />
          {p.source === 'ai_suggested' && <Pill label="AI suggested" bg={c.aiBg} fg={c.aiFg} height={22} />}
          <T size={12} color={c.text2}>{costRange(p.cost)} · {ago(p.created_at)}</T>
        </View>
      </Press>
    </View>
  );
}
