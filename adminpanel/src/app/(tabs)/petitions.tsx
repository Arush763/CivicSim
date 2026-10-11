import { router } from 'expo-router';
import { FlatList, RefreshControl, View } from 'react-native';
import { Body, Card, Fill, Muted, Notice, PageHeader, Press, Screen, pageColumn, stagger } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fetchPetitions, useAsync } from '@/lib/data';
import { fonts, useTheme } from '@/lib/theme';

export default function PetitionsScreen() {
  const t = useTheme();
  const { devMode } = useAuth();
  const list = useAsync(fetchPetitions, []);

  if (devMode) {
    return (
      <View style={pageColumn}>
        <PageHeader kicker="BACK A REQUEST" title="Petitions" />
        <Notice>Petitions are stored in Supabase. Connect it (see the README) to turn this tab on.</Notice>
      </View>
    );
  }
  return (
    <Screen>
      <FlatList
        contentContainerStyle={pageColumn}
        data={list.data ?? []}
        keyExtractor={(p) => p.id}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.refresh} />}
        ListHeaderComponent={<View style={{ gap: 10 }}><PageHeader kicker="BACK A REQUEST" title="Petitions" />{list.error && <Notice kind="error">{list.error.message}</Notice>}</View>}
        ListEmptyComponent={list.loading ? null : <Muted>No petitions yet. Authors can turn a proposal into a petition.</Muted>}
        renderItem={({ item: p, index }) => {
          const pct = Math.min(100, (p.signature_count / p.goal) * 100);
          return (
            <Press scaleTo={0.98} onPress={() => router.push({ pathname: '/proposal/[id]', params: { id: p.proposal_id } })}>
              <Card delay={stagger(index)}>
                <Body style={{ fontFamily: fonts.bodySemi, color: t.text, fontSize: 15 }}>{p.proposal?.title ?? 'Proposal'}</Body>
                <Muted>
                  {p.signature_count} / {p.goal} signatures{p.status === 'goal_reached' ? ' · goal reached' : ''}
                </Muted>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: t.border, overflow: 'hidden' }}>
                  <Fill fraction={pct / 100} color={p.status === 'goal_reached' ? t.good : t.accent} delay={stagger(index, 400)} />
                </View>
              </Card>
            </Press>
          );
        }}
      />
    </Screen>
  );
}
