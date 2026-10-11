import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createAccount } from './api';
import { supabase } from './supabase';

interface AuthState {
  /** Local-only mode: no Supabase, everyone is "dev-user" (for trying the app before it's connected). */
  devMode: boolean;
  session: Session | null;
  userId: string | null;
  ready: boolean;
  /** Token for the laptop server (Supabase access token, or the dev user id). */
  token: () => Promise<string | null>;
  signUp: (a: { email: string; password: string; firstName: string; lastName: string }) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const DEV_USER = 'dev-user';
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
      // Email and password, with no confirmation email: the laptop server makes the account
      // already confirmed (Supabase's own sender allows only a few emails an hour), then we sign in.
      signUp: async ({ email, password, firstName, lastName }) => {
        await createAccount({ email, password, firstName, lastName });
        const { error } = await supabase!.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      signIn: async (email, password) => {
        const { error } = await supabase!.auth.signInWithPassword({ email, password });
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
