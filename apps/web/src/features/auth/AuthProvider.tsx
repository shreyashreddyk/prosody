import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { supabase } from "../../lib/supabase";

type AuthContextValue = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) {
        return;
      }
      setSession(data.session ?? null);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user,
      async signInWithGoogle() {
        const redirectTo = `${window.location.origin}/auth/callback`;
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo }
        });
        if (error) {
          throw error;
        }
      },
      async signOut() {
        const { error } = await supabase.auth.signOut();
        if (error) {
          throw error;
        }
      }
    }),
    [loading, session, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}
