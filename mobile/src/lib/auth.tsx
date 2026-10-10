import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

interface AuthState {
  /** Local-only dev mode: no Supabase, everyone is "dev-user". */
  devMode: boolean;
  session: Session | null;
  userId: string | null;
  ready: boolean;
  /** Token to send to the PC server (Supabase access token, or the dev user id). */
  token: () => Promise<string | null>;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const DEV_USER = 'dev-user';
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!supabase);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      devMode: !supabase,
      session,
      userId: supabase ? session?.user.id ?? null : DEV_USER,
      ready,
      token: async () => {
        if (!supabase) return DEV_USER;
        const { data } = await supabase.auth.getSession(); // refreshes if needed
        return data.session?.access_token ?? null;
      },
      // Email one-time code (the Supabase "Magic Link" email template must include {{ .Token }}).
      sendCode: async (email) => {
        const { error } = await supabase!.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
        if (error) throw error;
      },
      verifyCode: async (email, code) => {
        const { error } = await supabase!.auth.verifyOtp({ email, token: code, type: 'email' });
        if (error) throw error;
      },
      signOut: async () => {
        await supabase?.auth.signOut();
      },
    }),
    [session, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
