import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { fetchProfile, updateProfile } from '@/lib/data';
import { useTheme } from '@/lib/settings';
import { fonts } from '@/lib/theme';
import { Icon } from './Icon';
import { Button, Notice, Rise, T } from './ui';

/** Supabase gives new people "name-1a2b"; they're offered the chance to pick their own once. */
const looksAuto = (u: string) => /-[0-9a-f]{4}$/.test(u);
const PICKED_KEY = 'civicsim.usernameAsked';

/**
 * Everyone signs in (with a code sent by email) before using the app, so requests, votes and
 * petitions belong to a person. In local-only mode (no Supabase yet) there's nothing to sign in to.
 */
export function SignInGate({ children }: { children: ReactNode }) {
  const { devMode, ready, session, userId } = useAuth();
  const c = useTheme();
  const [askName, setAskName] = useState<string | null>(null);

  useEffect(() => {
    if (devMode || !userId) return;
    let cancelled = false;
    (async () => {
      if (await AsyncStorage.getItem(`${PICKED_KEY}.${userId}`).catch(() => null)) return;
      const p = await fetchProfile(userId).catch(() => null);
      if (!cancelled && p && looksAuto(p.username)) setAskName(p.username);
    })();
    return () => {
      cancelled = true;
    };
  }, [devMode, userId]);

  if (devMode) return <>{children}</>;
  if (!ready) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  if (!session) return <SignIn />;
  if (askName !== null && userId) {
    const done = () => {
      void AsyncStorage.setItem(`${PICKED_KEY}.${userId}`, '1').catch(() => {});
      setAskName(null);
    };
    return <PickUsername current={askName} userId={userId} onDone={done} />;
  }
  return <>{children}</>;
}

function Frame({ children }: { children: ReactNode }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }} keyboardShouldPersistTaps="handled">
        <Rise>
          <View style={{ backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.border, padding: 22, gap: 16 }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.accentBg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="map" size={28} color={c.accentFg} />
            </View>
            {children}
          </View>
        </Rise>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const c = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      <T size={12} weight="medium" color={c.text2}>{label}</T>
      <TextInput
        {...rest}
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        style={[{ height: 48, paddingHorizontal: 14, borderWidth: 1, borderColor: c.line, borderRadius: 10, fontSize: 16, fontFamily: fonts.regular, color: c.text, backgroundColor: c.surface }, style]}
      />
    </View>
  );
}

function SignIn() {
  const c = useTheme();
  const { sendCode, verifyCode } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async (fn: () => Promise<void>) => {
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

  return (
    <Frame>
      <View style={{ gap: 6 }}>
        <T size={26} weight="bold" accessibilityRole="header">CivicSim</T>
        <T size={15} color={c.text2}>
          {sent ? `We sent a code to ${email.trim()}. Enter it below.` : 'Propose changes to your streets, see them before they’re built, and back the ideas you like.'}
        </T>
      </View>
      {!sent ? (
        <>
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" returnKeyType="send"
            onSubmitEditing={() => /\S+@\S+\.\S+/.test(email) && go(async () => { await sendCode(email.trim()); setSent(true); })} />
          <Button title="Email me a code" icon="mail" busy={busy} disabled={!/\S+@\S+\.\S+/.test(email)} onPress={() => go(async () => { await sendCode(email.trim()); setSent(true); })} />
        </>
      ) : (
        <>
          <Field label="Code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 8))} placeholder="123456" keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode"
            style={{ letterSpacing: 4, fontSize: 20 }} />
          <Button title="Sign in" busy={busy} disabled={code.length < 6} onPress={() => go(() => verifyCode(email.trim(), code))} />
          <Button title="Use a different email" kind="outline" height={44} onPress={() => { setSent(false); setCode(''); setError(null); }} />
        </>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </Frame>
  );
}

function PickUsername({ current, userId, onDone }: { current: string; userId: string; onDone: () => void }) {
  const c = useTheme();
  const [name, setName] = useState(current.replace(/-[0-9a-f]{4}$/, ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^[a-zA-Z0-9._-]{2,32}$/.test(name);
  return (
    <Frame>
      <View style={{ gap: 6 }}>
        <T size={22} weight="bold" accessibilityRole="header">Pick a username</T>
        <T size={15} color={c.text2}>It’s shown on your requests, petitions and the leaderboard.</T>
      </View>
      <Field label="Username" value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} maxLength={32} />
      {!valid && name.length > 0 && <T size={12} color={c.text2}>2–32 letters, numbers, dots, dashes or underscores.</T>}
      <Button
        title="Save"
        busy={busy}
        disabled={!valid}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            await updateProfile(userId, { username: name });
            onDone();
          } catch (e) {
            const m = (e as Error).message;
            setError(/duplicate|unique/i.test(m) ? 'That username is taken. Try another.' : m);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button title={`Keep ${current}`} kind="outline" height={44} onPress={onDone} />
      {error && <Notice kind="error">{error}</Notice>}
    </Frame>
  );
}
