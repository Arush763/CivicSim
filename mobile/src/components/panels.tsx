import type { AreaIssue, CostEstimate, RenderJobInfo } from '@mamdani/shared';
import { ActivityIndicator, Text, View } from 'react-native';
import { ISSUE_LABELS, money, useTheme } from '@/lib/theme';
import { Card, H2, Muted, Row } from './ui';

export function IssueBars({ issues, limit = 6 }: { issues: AreaIssue[]; limit?: number }) {
  const t = useTheme();
  const max = Math.max(1, ...issues.map((i) => i.count));
  const total = issues.reduce((s, i) => s + i.count, 0);
  return (
    <Card>
      <H2>Current issues</H2>
      <Muted>{total.toLocaleString()} 311 complaints in the last 90 days</Muted>
      {issues.slice(0, limit).map((i) => (
        <View key={i.category} style={{ gap: 3 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: t.text, fontSize: 14 }}>{ISSUE_LABELS[i.category] ?? i.category}</Text>
            <Text style={{ color: t.muted, fontSize: 14, fontVariant: ['tabular-nums'] }}>{i.count}</Text>
          </Row>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: t.border }}>
            <View style={{ height: 6, borderRadius: 3, width: `${(i.count / max) * 100}%`, backgroundColor: t.warn }} />
          </View>
        </View>
      ))}
    </Card>
  );
}

export function CostPanel({ cost, title = 'Estimated cost' }: { cost: CostEstimate; title?: string }) {
  const t = useTheme();
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <H2>{title}</H2>
        <Text style={{ color: t.text, fontSize: 20, fontWeight: '700' }}>{money(cost.total)}</Text>
      </Row>
      <Muted>
        Planning range {money(cost.low)} – {money(cost.high)}, including 20% contingency. Based on placeholder unit costs, not a city budget.
      </Muted>
      {cost.items.map((item, i) => (
        <Row key={i} style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 14 }}>{item.label}</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>
              {item.quantity.toLocaleString()} {item.unit} × {money(item.unitCost)}
            </Text>
          </View>
          <Text style={{ color: t.text, fontSize: 14, fontVariant: ['tabular-nums'] }}>{money(item.total)}</Text>
        </Row>
      ))}
    </Card>
  );
}

const STATUS_TEXT: Record<string, string> = {
  queued: 'Queued for rendering',
  building: 'Building 3D model…',
  lod_ready: 'Preview ready, refining…',
  done: 'Render ready',
  failed: 'Render failed',
  superseded: 'Updating…',
};

export function RenderChip({ job }: { job: RenderJobInfo | null }) {
  const t = useTheme();
  if (!job) return null;
  const busy = job.status !== 'done' && job.status !== 'failed';
  const color = job.status === 'done' ? t.good : job.status === 'failed' ? t.danger : t.accent;
  return (
    <Row>
      {busy ? <ActivityIndicator size="small" color={color} /> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />}
      <Text style={{ color, fontSize: 13, fontWeight: '600' }}>{STATUS_TEXT[job.status] ?? job.status}</Text>
    </Row>
  );
}
