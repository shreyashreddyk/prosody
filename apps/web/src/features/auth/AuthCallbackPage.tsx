import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "./AuthProvider";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const code = new URLSearchParams(window.location.search).get("code");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(Boolean(code));

  useEffect(() => {
    const exchange = async () => {
      if (!code) {
        setExchanging(false);
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        setErrorMessage(error.message);
        setExchanging(false);
        return;
      }

      navigate("/app", { replace: true });
    };

    void exchange();
  }, [code, navigate]);

  if (!code && session) {
    return <Navigate to="/app" replace />;
  }

  return (
    <main className="centered-page">
      <div className="glass-card">
        <p className="eyebrow">Prosody</p>
        <h1>Completing sign-in</h1>
        <p>
          {errorMessage ??
            (exchanging
              ? "We are finishing your Google sign-in and redirecting you into the app."
              : "We could not complete sign-in automatically. Please try signing in again.")}
        </p>
      </div>
    </main>
  );
}
