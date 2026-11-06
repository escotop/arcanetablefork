import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type ParentComponent,
} from 'solid-js';
import { supabase } from '~/lib/supabase';

type AuthContextValue = {
  /** False when Supabase isn't configured. */
  enabled: boolean;
  /** True until the stored session has been checked. */
  loading: Accessor<boolean>;
  session: Accessor<Session | null>;
  user: Accessor<User | null>;
  signIn: (email: string, password: string) => Promise<void>;
  /** Returns true when the account needs email confirmation before signing in. */
  signUp: (email: string, password: string, username: string) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>();

function requireClient() {
  if (!supabase) throw new Error('Accounts are not available right now.');
  return supabase;
}

export const AuthProvider: ParentComponent = props => {
  const [session, setSession] = createSignal<Session | null>(null);
  const [loading, setLoading] = createSignal(!!supabase);

  onMount(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    onCleanup(() => data.subscription.unsubscribe());
  });

  const value: AuthContextValue = {
    enabled: !!supabase,
    loading,
    session,
    user: () => session()?.user ?? null,
    async signIn(email, password) {
      const { error } = await requireClient().auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signUp(email, password, username) {
      const { data, error } = await requireClient().auth.signUp({
        email,
        password,
        options: {
          data: { username },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      return { needsConfirmation: !data.session };
    },
    async signOut() {
      const { error } = await requireClient().auth.signOut();
      if (error) throw error;
    },
  };

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Name to show for the signed-in user. */
export function displayName(user: User | null) {
  if (!user) return '';
  const username = user.user_metadata?.username;
  return typeof username === 'string' && username.trim() ? username : (user.email ?? 'Account');
}
