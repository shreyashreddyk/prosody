import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export function LandingPage() {
  const { session, signInWithGoogle } = useAuth();

  if (session) {
    return <Navigate to="/app" replace />;
  }

  return (
    <main className="landing-page">
      <section className="landing-hero">
        <p className="eyebrow">Realtime Coaching, Now Persistent</p>
        <h1>Prosody keeps your interview practice, sessions, and source material in one authenticated workspace.</h1>
        <p className="landing-copy">
          Sign in with Google to continue previous conversations, review multi-session history, upload source material,
          and coach against the same workspace over time.
        </p>
        <div className="landing-actions">
          <button className="primary-button" onClick={() => void signInWithGoogle()}>
            Continue With Google
          </button>
          <a className="secondary-link" href="https://supabase.com/">
            Backed by Supabase Auth, Storage, and Postgres
          </a>
        </div>
      </section>
    </main>
  );
}
