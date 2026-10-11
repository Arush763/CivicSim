import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/settings';
import { fonts } from '@/lib/theme';
import { Icon } from './Icon';
import { Button, Notice, Rise, T } from './ui';

/**
 * Everyone has an account (email and password) before using the app, so requests, votes and
 * petitions belong to a person. In local-only mode (no Supabase yet) there's nothing to sign in to.
 */
export function SignInGate({ children }: { children: ReactNode }) {
  const { devMode, ready, session } = useAuth();
  const c = useTheme();
  if (devMode) return <>{children}</>;
  if (!ready) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  if (!session) return <SignIn />;
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

const isEmail = (v: string) => /\S+@\S+\.\S+/.test(v.trim());

function SignIn() {
  const c = useTheme();
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signingUp = mode === 'signup';
  const ready = isEmail(email) && password.length >= 6 && (!signingUp || (firstName.trim().length > 0 && lastName.trim().length > 0));

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (signingUp) await signUp({ email: email.trim(), password, firstName: firstName.trim(), lastName: lastName.trim() });
      else await signIn(email.trim(), password);
    } catch (e) {
      const m = (e as Error).message;
      setError(/invalid login credentials/i.test(m) ? 'Wrong email or password.' : /already registered/i.test(m) ? 'There’s already an account with this email. Sign in instead.' : m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame>
      <View style={{ gap: 6 }}>
        <T size={26} weight="bold" accessibilityRole="header">CivicSim</T>
        <T size={15} color={c.text2}>
          {signingUp ? 'Propose changes to your streets, see them before they’re built, and back the ideas you like.' : 'Welcome back. Sign in to your account.'}
        </T>
      </View>
      {signingUp && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Field label="First name" value={firstName} onChangeText={setFirstName} autoComplete="given-name" textContentType="givenName" autoCapitalize="words" maxLength={40} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Last name" value={lastName} onChangeText={setLastName} autoComplete="family-name" textContentType="familyName" autoCapitalize="words" maxLength={40} />
          </View>
        </View>
      )}
      <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete={signingUp ? 'new-password' : 'current-password'}
        textContentType={signingUp ? 'newPassword' : 'password'} returnKeyType="go" onSubmitEditing={submit} />
      {signingUp && password.length > 0 && password.length < 6 && <T size={12} color={c.text2}>At least 6 characters.</T>}
      <Button title={signingUp ? 'Create account' : 'Sign in'} busy={busy} disabled={!ready} onPress={submit} />
      <Button title={signingUp ? 'I already have an account' : 'Create a new account'} kind="outline" height={44}
        onPress={() => { setMode(signingUp ? 'signin' : 'signup'); setError(null); }} />
      {error && <Notice kind="error">{error}</Notice>}
    </Frame>
  );
}
