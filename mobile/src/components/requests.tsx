import type { SceneIndex } from '@mamdani/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { myVote, setProposalStatus, setVote, useIsAdmin, type Proposal } from '@/lib/data';
import { describeOp } from '@/lib/ops';
import { fonts, money, useTheme } from '@/lib/theme';
import { Icon } from './icons';
import { Button, IconButton, InnerCard, Label, Mono, Muted, Notice, Pill, Row } from './ui';

export const STATUS_LABEL: Record<Proposal['status'], string> = {
  submitted: 'Waiting',
  under_review: 'Under review',
  accepted: 'Approved',
  rejected: 'Rejected',
};

export function StatusChip({ status, long }: { status: Proposal['status']; long?: boolean }) {
  const label = long && status === 'submitted' ? 'Awaiting city decision' : STATUS_LABEL[status];
  return <Pill label={label} kind={status === 'accepted' ? 'approved' : status === 'rejected' ? 'rejected' : 'waiting'} />;
}

/** One line summing up a request's changes: "Protected bike lane, both sides (+1 more)". */
export function summarize(p: Proposal, scene?: SceneIndex | null): string {
  if (!p.ops.length) return '';
  const first = describeOp(p.ops[0], scene);
  return p.ops.length > 1 ? `${first} (+${p.ops.length - 1} more)` : first;
}

/** Your vote on a request, kept in sync after you change it. */
function useMyVote(p: Proposal) {
  const { userId } = useAuth();
  const [vote, setVoteState] = useState(p.my_vote ?? 0);
  useEffect(() => {
    if (p.my_vote !== undefined) setVoteState(p.my_vote);
    else if (userId) void myVote(p.id, userId).then(setVoteState);
  }, [p.id, p.my_vote, userId]);
  return [vote, setVoteState] as const;
}

/**
 * Residents confirm or deny a requested change; an admin then approves or rejects it.
 * Tapping your current vote again takes it back.
 */
export function DecisionBar({ proposal: p, onChanged, size = 'compact', viewIn3D }: {
  proposal: Proposal;
  onChanged: () => void;
  size?: 'compact' | 'large';
  /** Show the green "view in 3D" button (compact cards). */
  viewIn3D?: boolean;
}) {
  const t = useTheme();
  const { userId, devMode, token } = useAuth();
  const isAdmin = useIsAdmin();
  const [vote, setVoteState] = useMyVote(p);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAuthor = !devMode && userId === p.author_id;
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
  const cast = (v: -1 | 1) =>
    act(v === 1 ? 'confirm' : 'deny', async () => {
      const next = vote === v ? 0 : v;
      await setVote(p.id, userId!, next);
      setVoteState(next);
    });

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
            <View style={{ width: total ? `${(p.confirm_count / total) * 100}%` : '0%', height: 8, backgroundColor: t.accent }} />
          </View>
        </View>
      )}
      {!userId ? (
        <Muted>Sign in on the "You" tab to confirm or deny.</Muted>
      ) : (
        <View style={{ flexDirection: 'row', gap: large ? 10 : 8 }}>
          <Button
            small={!large}
            style={{ flex: 1 }}
            kind={vote === 1 ? 'primary' : 'outline'}
            icon={<Icon name="check" size={large ? 20 : 18} color={vote === 1 ? t.accentText : t.accent} strokeWidth={2.4} />}
            title={large ? (vote === 1 ? 'Confirmed' : 'Confirm') : `Confirm · ${p.confirm_count}`}
            onPress={() => cast(1)}
            busy={busy === 'confirm'}
            disabled={isAuthor}
          />
          <Button
            small={!large}
            style={[{ flex: 1 }, vote === -1 && { backgroundColor: t.borderStrong }]}
            kind="secondary"
            icon={<Icon name="close" size={large ? 18 : 16} color={t.text} strokeWidth={2.4} />}
            title={large ? (vote === -1 ? 'Denied' : 'Deny') : `Deny · ${p.deny_count}`}
            onPress={() => cast(-1)}
            busy={busy === 'deny'}
            disabled={isAuthor}
          />
          {viewIn3D && (
            <IconButton label="View the change in 3D" tint="transparent" onPress={() => router.push({ pathname: '/proposal/[id]', params: { id: p.id } })} style={{ borderColor: t.borderStrong }}>
              <Icon name="cube" size={20} color={t.accent} />
            </IconButton>
          )}
        </View>
      )}
      {isAuthor && <Muted>You can't vote on your own request.</Muted>}
      {isAdmin && (
        <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 10 }}>
          <Label color={t.muted}>CITY DECISION{devMode ? ' · YOU ARE ADMIN IN TEST MODE' : ''}</Label>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button small style={{ flex: 1 }} kind={p.status === 'accepted' ? 'primary' : 'outline'} title="Approve" busy={busy === 'accepted'}
              onPress={() => act('accepted', () => setProposalStatus(p.id, 'accepted', token))} />
            <Button small style={{ flex: 1 }} kind={p.status === 'rejected' ? 'danger' : 'secondary'} title="Reject" busy={busy === 'rejected'}
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
