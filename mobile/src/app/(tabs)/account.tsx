import { rankFor, RANK_TIERS } from '@mamdani/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { Body, Button, Card, H1, H2, Muted, Notice, PageHeader, pageColumn, Row } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { SERVER_URL } from '@/lib/config';
import { fetchProfile, fetchProposals, useApi, useAsync } from '@/lib/data';
import { fonts, money, useTheme } from '@/lib/theme';

export default function AccountScreen() {
  const t = useTheme();
  const auth = useAuth();
  const api = useApi();
  const health = useAsync(() => api.health(), [api]);
  const profile = useAsync(async () => (auth.userId && !auth.devMode ? fetchProfile(auth.userId) : null), [auth.userId, auth.devMode]);
  const mine = useAsync(async () => (auth.userId ? fetchProposals({ authorId: auth.userId }) : []), [auth.userId]);
  const drafts = useAsync(async () => (auth.userId ? api.drafts() : []), [api, auth.userId]);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const signedIn = auth.devMode || !!auth.session;
  const points = profile.data?.points ?? 0;
  const next = RANK_TIERS.find((r) => r.min > points);

  return (
    <ScrollView contentContainerStyle={{ ...pageColumn, gap: 14 }} keyboardShouldPersistTaps="handled">
      <PageHeader kicker="YOUR ACCOUNT" title="You" />
      {!signedIn ? (
        <Card>
          <H1>Sign in</H1>
          <Muted>We'll email you a 6-digit code. No password needed.</Muted>
          <TextInput
            style={[styles.input, { color: t.text, borderColor: t.border }]}
            placeholder="you@example.com"
            placeholderTextColor={t.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          {sent && (
            <TextInput
              style={[styles.input, { color: t.text, borderColor: t.border }]}
              placeholder="6-digit code"
              placeholderTextColor={t.muted}
              keyboardType="number-pad"
              value={code}
              onChangeText={setCode}
              maxLength={8}
            />
          )}
          {sent ? (
            <Button title="Verify code" busy={busy} disabled={code.length < 6} onPress={() => run(() => auth.verifyCode(email.trim(), code.trim()))} />
          ) : (
            <Button title="Email me a code" busy={busy} disabled={!email.includes('@')} onPress={() => run(async () => { await auth.sendCode(email.trim()); setSent(true); })} />
          )}
        </Card>
      ) : (
        <Card>
          <H1>{auth.devMode ? 'Local dev user' : profile.data?.username ?? auth.session?.user.email}</H1>
          {!auth.devMode && (
            <>
              <Row style={{ justifyContent: 'space-between' }}>
                <Body>{profile.data?.rank ?? rankFor(points)}</Body>
                <Text style={{ color: t.text, fontSize: 20, fontFamily: fonts.monoMedium }}>{points} pts</Text>
              </Row>
              {next && <Muted>{next.min - points} points to {next.name}</Muted>}
              {profile.data?.role === 'admin' && <Muted>City admin: you can change proposal status.</Muted>}
              <Button title="Sign out" kind="secondary" small onPress={() => run(auth.signOut)} />
            </>
          )}
        </Card>
      )}
      {error && <Notice kind="error">{error}</Notice>}

      {signedIn && (
        <>
          <Card>
            <H2>Your drafts</H2>
            <Muted>Saved on the PC server until you submit.</Muted>
            {drafts.data?.length === 0 && <Muted>None.</Muted>}
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
            <H2>Your proposals</H2>
            {mine.data?.length === 0 && <Muted>None yet.</Muted>}
            {mine.data?.map((p) => (
              <Pressable key={p.id} onPress={() => router.push({ pathname: '/proposal/[id]', params: { id: p.id } })}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Body>{p.title}</Body>
                  <Muted>{p.status.replace('_', ' ')}</Muted>
                </Row>
              </Pressable>
            ))}
          </Card>
        </>
      )}

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

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 16, fontFamily: fonts.body },
});
