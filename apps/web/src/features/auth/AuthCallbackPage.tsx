import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "./AuthProvider";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const exchange = async () => {
      const code = new URLSearchParams(window.location.search).get("code");
      if (!code) {
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        setErrorMessage(error.message);
        return;
      }

      navigate("/app", { replace: true });
    };

    void exchange();
  }, [navigate]);

  if (session) {
    return <Navigate to="/app" replace />;
  }

  return (
    <main className="centered-page">
      <div className="glass-card">
        <p className="eyebrow">Prosody</p>
        <h1>Completing sign-in</h1>
        <p>{errorMessage ?? "We are finishing your Google sign-in and redirecting you into the app."}</p>
      </div>
    </main>
  );
}
