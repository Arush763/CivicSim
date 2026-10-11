import type { SceneIndex } from '@mamdani/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { setProposalStatus, useIsAdmin, type Proposal } from '@/lib/data';
import { describeOp } from '@/lib/ops';
import { fonts, money, useTheme } from '@/lib/theme';
import { Icon } from './icons';
import { Button, Fill, IconButton, InnerCard, Label, Mono, Muted, Notice, Pill, Row } from './ui';

export const STATUS_LABEL: Record<Proposal['status'], string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  accepted: 'Approved',
  rejected: 'Rejected',
};

export function StatusChip({ status, long }: { status: Proposal['status']; long?: boolean }) {
  const label = long && status === 'submitted' ? 'Awaiting city decision' : STATUS_LABEL[status];
  return <Pill label={label} kind={status === 'accepted' ? 'approved' : status === 'rejected' ? 'rejected' : status === 'under_review' ? 'review' : 'waiting'} />;
}

/** One line summing up a request's changes: "Protected bike lane, both sides (+1 more)". */
export function summarize(p: Proposal, scene?: SceneIndex | null): string {
  if (!p.ops.length) return '';
  const first = describeOp(p.ops[0], scene);
  return p.ops.length > 1 ? `${first} (+${p.ops.length - 1} more)` : first;
}

/**
 * Residents confirm or deny a requested change in the phone app; the admin sees the tally here
 * and approves or rejects it.
 */
export function DecisionBar({ proposal: p, onChanged, size = 'compact', viewIn3D }: {
  proposal: Proposal;
  onChanged: () => void;
  size?: 'compact' | 'large';
  /** Show the green "view in 3D" button (compact cards). */
  viewIn3D?: boolean;
}) {
  const t = useTheme();
  const { devMode, token } = useAuth();
  const isAdmin = useIsAdmin();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const large = size === 'large';

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const total = p.confirm_count + p.deny_count;
  return (
    <View style={{ gap: large ? 14 : 8 }}>
      {large && (
        <View style={{ gap: 8 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Muted>{p.confirm_count} confirm</Muted>
            <Muted>{p.deny_count} deny</Muted>
          </Row>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.border, overflow: 'hidden' }}>
            <Fill fraction={total ? p.confirm_count / total : 0} color={t.accent} />
          </View>
        </View>
      )}
      {!large && (
        <Row style={{ justifyContent: 'space-between' }}>
          <Muted>{p.confirm_count} confirm · {p.deny_count} deny</Muted>
          {viewIn3D && (
            <IconButton label="View the change in 3D" tint="transparent" onPress={() => router.push({ pathname: '/proposal/[id]', params: { id: p.id } })} style={{ borderColor: t.borderStrong }}>
              <Icon name="cube" size={20} color={t.accent} />
            </IconButton>
          )}
        </Row>
      )}
      {isAdmin && (
        <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 10 }}>
          <Label color={t.muted}>CITY DECISION{devMode ? ' · YOU ARE ADMIN IN TEST MODE' : ''}</Label>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button small style={{ flex: 1 }} kind="approve" title={p.status === 'accepted' ? 'Approved' : 'Approve'} busy={busy === 'accepted'}
              onPress={() => act('accepted', () => setProposalStatus(p.id, 'accepted', token))} />
            <Button small style={{ flex: 1 }} kind="danger" title={p.status === 'rejected' ? 'Rejected' : 'Reject'} busy={busy === 'rejected'}
              onPress={() => act('rejected', () => setProposalStatus(p.id, 'rejected', token))} />
            {p.status !== 'submitted' && (
              <Button small kind="secondary" title="Reopen" busy={busy === 'submitted'} onPress={() => act('submitted', () => setProposalStatus(p.id, 'submitted', token))} />
            )}
          </View>
        </View>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </View>
  );
}

/** One requested change as it appears in a zone's panel. */
export function RequestCard({ proposal: p, scene, onChanged }: { proposal: Proposal; scene?: SceneIndex | null; onChanged: () => void }) {
  const t = useTheme();
  return (
    <InnerCard>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <Text style={{ color: t.text, fontFamily: fonts.bodySemi, fontSize: 15, flex: 1 }}>{p.title}</Text>
        <StatusChip status={p.status} />
      </View>
      {p.source === 'ai_suggested' && <Pill label="Started from AI suggestion" kind="ai" />}
      <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }}>
        {summarize(p, scene)} · <Mono size={13}>{p.cost ? money(p.cost.total) : 'Pending estimate'}</Mono>
      </Text>
      <DecisionBar proposal={p} onChanged={onChanged} viewIn3D />
    </InnerCard>
  );
}
