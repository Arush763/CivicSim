import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, View } from 'react-native';
import { StatusChip } from '@/components/requests';
import { Body, Card, Chip, Muted, Notice, PageHeader, pageColumn, Row } from '@/components/ui';
import { fetchProposals, useAsync, useProposalUpdates } from '@/lib/data';
import { fonts, money, useTheme } from '@/lib/theme';

export default function ProposalsScreen() {
  const t = useTheme();
  const [sort, setSort] = useState<'new' | 'top'>('new');
  const list = useAsync(() => fetchProposals({ sort }), [sort]);
  useProposalUpdates(list.refresh);

  return (
    <FlatList
      contentContainerStyle={pageColumn}
      data={list.data ?? []}
      keyExtractor={(p) => p.id}
      refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.refresh} />}
      ListHeaderComponent={
        <View style={{ gap: 10 }}>
          <PageHeader kicker="EVERY ZONE" title="Requests" />
          <Row>
            <Chip label="Newest" color={t.accent} active={sort === 'new'} onPress={() => setSort('new')} />
            <Chip label="Most confirmed" color={t.accent} active={sort === 'top'} onPress={() => setSort('top')} />
          </Row>
          {list.error && <Notice kind="error">{list.error.message}</Notice>}
        </View>
      }
      ListEmptyComponent={list.loading ? null : <Muted>No requests yet. Open the map, tap a zone and request a change.</Muted>}
      renderItem={({ item: p }) => (
        <Pressable onPress={() => router.push({ pathname: '/proposal/[id]', params: { id: p.id } })}>
          <Card>
            <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              {p.thumb_url && <Image source={{ uri: p.thumb_url }} style={{ width: 72, height: 72, borderRadius: 8 }} />}
              <View style={{ flex: 1, gap: 4 }}>
                <Body style={{ fontFamily: fonts.bodySemi, color: t.text, fontSize: 15 }}>{p.title}</Body>
                <Muted>
                  {p.cost ? money(p.cost.total) : 'Pending estimate'} · {p.ops.length} change{p.ops.length === 1 ? '' : 's'} · ✓ {p.confirm_count} ✕ {p.deny_count}
                </Muted>
                <Row>
                  <StatusChip status={p.status} />
                  {p.processing_status && p.processing_status !== 'ready' && <Chip label={p.processing_status === 'failed' ? 'Preview failed' : 'Preparing preview'} color={t.accent} />}
                  {p.source === 'ai_suggested' && <Chip label="AI-assisted" color={t.ai} />}
                  {p.author && <Muted>{p.author.username}</Muted>}
                </Row>
              </View>
            </Row>
          </Card>
        </Pressable>
      )}
    />
  );
}
