import { RANK_TIERS } from '@mamdani/shared';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { Card, H2, Muted, Notice, PageHeader, Row, Screen, pageColumn, stagger } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fetchLeaderboard, useAsync } from '@/lib/data';
import { fonts, useTheme } from '@/lib/theme';

export default function LeaderboardScreen() {
  const t = useTheme();
  const { devMode } = useAuth();
  const list = useAsync(fetchLeaderboard, []);

  const header = (
    <View style={{ gap: 10 }}>
      <PageHeader kicker="LEADERBOARD" title="Ranks" />
      <Card>
        <H2>How points work</H2>
        <Muted>Submit a proposal +10 · Someone supports it +2 · Sign a petition +1 · Your petition hits its goal +50 · The city accepts your proposal +100</Muted>
        <Row>
          {RANK_TIERS.map((r) => (
            <Muted key={r.name}>{r.name} {r.min}+</Muted>
          ))}
        </Row>
      </Card>
      {devMode && <Notice>The leaderboard is stored in Supabase. Connect it to turn this tab on.</Notice>}
      {list.error && <Notice kind="error">{list.error.message}</Notice>}
    </View>
  );

  return (
    <Screen>
      <FlatList
        contentContainerStyle={{ ...pageColumn, gap: 8 }}
        data={list.data ?? []}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.refresh} />}
        ListEmptyComponent={list.loading || devMode ? null : <Muted>No one has points yet.</Muted>}
        renderItem={({ item: r, index }) => (
          <Card delay={stagger(index, 200)}>
            <Row style={{ flexWrap: 'nowrap' }}>
              <Text style={{ color: t.muted, width: 34, fontSize: 16, fontFamily: fonts.monoMedium }}>#{r.position}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: 16, fontFamily: fonts.bodySemi }}>{r.username}</Text>
                <Muted>{r.rank}</Muted>
              </View>
              <Text style={{ color: t.text, fontSize: 18, fontFamily: fonts.monoMedium }}>{r.points}</Text>
            </Row>
          </Card>
        )}
      />
    </Screen>
  );
}
