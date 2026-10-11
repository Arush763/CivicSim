import { router } from 'expo-router';
import { Pressable, ScrollView } from 'react-native';
import { Body, Card, H2, Muted, PageHeader, pageColumn, Row } from '@/components/ui';
import { SERVER_URL } from '@/lib/config';
import { useApi, useAsync } from '@/lib/data';
import { money } from '@/lib/theme';

/** The admin panel has no accounts: this tab is its drafts and the connection to the server. */
export default function AdminScreen() {
  const api = useApi();
  const health = useAsync(() => api.health(), [api]);
  const drafts = useAsync(() => api.drafts(), [api]);

  return (
    <ScrollView contentContainerStyle={{ ...pageColumn, gap: 14 }}>
      <PageHeader kicker="CITY ADMIN PANEL" title="Admin" />
      <Card>
        <H2>City admin</H2>
        <Muted>No sign-in needed: whoever uses this panel on the server computer decides on requests and can use the AI tools. Phones can only make requests.</Muted>
      </Card>
      <Card>
        <H2>Drafts</H2>
        <Muted>Saved on the PC server until you submit.</Muted>
        {drafts.data?.length === 0 && <Muted>None.</Muted>}
        {drafts.error && <Muted>{drafts.error.message}</Muted>}
        {drafts.data?.map((d) => (
          <Pressable key={d.id} onPress={() => router.push({ pathname: '/draft/[id]', params: { id: d.id } })}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Body>{d.title}</Body>
              <Muted>{money(d.cost.total)}</Muted>
            </Row>
          </Pressable>
        ))}
      </Card>
      <Card>
        <H2>Connection</H2>
        <Muted>PC server: {SERVER_URL || 'not set'}</Muted>
        <Muted>
          {health.data
            ? `Online · ${health.data.mode}${health.data.suggestions ? ' · AI suggestions on' : ''}`
            : health.error
              ? `Offline: ${health.error.message}`
              : 'Checking…'}
        </Muted>
      </Card>
    </ScrollView>
  );
}
