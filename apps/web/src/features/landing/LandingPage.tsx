import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

const FEATURES = [
  {
    icon: "💬",
    title: "Persistent Workspaces",
    description:
      "Every conversation persists across sessions. Resume where you left off with full history, sources, and metrics.",
  },
  {
    icon: "🎙️",
    title: "Live Voice Coaching",
    description:
      "Real-time AI coach that listens, responds, and adapts. Sub-second latency with live transcript tracking.",
  },
  {
    icon: "📄",
    title: "Source-Grounded Context",
    description:
      "Upload resumes, prompt notes, or presentation material. Your coach references them during live sessions.",
  },
];

const STEPS = [
  { step: "01", label: "Sign in with Google" },
  { step: "02", label: "Create a workspace" },
  { step: "03", label: "Upload your sources" },
  { step: "04", label: "Start a live session" },
];

export function LandingPage() {
  const { session, signInWithGoogle } = useAuth();

  if (session) {
    return <Navigate to="/app" replace />;
  }

  return (
    <main className="min-h-screen flex flex-col">
      {/* ── Hero ── */}
      <section className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left: copy */}
          <div className="animate-fade-in">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent-teal mb-4">
              Realtime AI Coach
            </p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight mb-6">
              Practice with AI.
              <br />
              <span className="text-accent-blue">Coach in realtime.</span>
              <br />
              Keep everything.
            </h1>
            <p className="text-text-secondary text-lg leading-relaxed max-w-md mb-8">
              Prosody is a persistent coaching workspace for interviews and
              presentations. Live voice sessions, source uploads, transcripts,
              summaries, and flashcards — all in one place.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                className="btn-primary text-base px-7 py-3"
                onClick={() => void signInWithGoogle()}
              >
                Continue with Google
              </button>
              <a
                href="#how-it-works"
                className="btn-secondary text-base px-6 py-3 no-underline"
              >
                How it works ↓
              </a>
            </div>
          </div>

          {/* Right: animated waveform visualization */}
          <div className="hidden lg:flex items-center justify-center animate-fade-in">
            <div className="relative w-72 h-72 flex items-center justify-center">
              {/* Ambient glow */}
              <div className="absolute inset-0 rounded-full bg-accent-teal/5 blur-3xl" />
              {/* Waveform bars */}
              <div className="relative flex items-center gap-1.5">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-2 rounded-full bg-gradient-to-t from-accent-teal to-accent-blue"
                    style={{
                      height: `${28 + Math.sin(i * 0.9) * 24 + 16}px`,
                      animation: `pulse-dot ${1.2 + i * 0.15}s ease-in-out infinite`,
                      animationDelay: `${i * 0.12}s`,
                    }}
                  />
                ))}
              </div>
              {/* Status labels */}
              <div className="absolute -bottom-4 flex gap-8 text-[10px] font-medium uppercase tracking-widest text-text-muted">
                <span className="text-accent-teal">Listening</span>
                <span className="text-accent-blue">Coaching</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature Grid ── */}
      <section className="px-6 py-16 border-t border-border-subtle">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="glass-panel-subtle p-6 flex flex-col gap-3 animate-slide-up"
            >
              <span className="text-2xl">{feature.icon}</span>
              <h3 className="text-sm font-semibold text-text-primary">
                {feature.title}
              </h3>
              <p className="text-xs leading-relaxed text-text-secondary">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How It Works ── */}
      <section
        id="how-it-works"
        className="px-6 py-16 border-t border-border-subtle"
      >
        <div className="max-w-3xl mx-auto">
          <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-text-muted mb-8 text-center">
            How it works
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {STEPS.map((item) => (
              <div key={item.step} className="text-center animate-slide-up">
                <p className="text-2xl font-bold text-accent-teal mb-2 font-mono">
                  {item.step}
                </p>
                <p className="text-sm text-text-secondary">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <section className="px-6 py-16 border-t border-border-subtle">
        <div className="max-w-lg mx-auto text-center">
          <h2 className="text-xl font-semibold mb-3">Ready to start?</h2>
          <p className="text-text-secondary text-sm mb-6">
            Sign in to create your first workspace. Your data stays in your
            Supabase account.
          </p>
          <button
            className="btn-primary text-base px-7 py-3"
            onClick={() => void signInWithGoogle()}
          >
            Continue with Google
          </button>
          <p className="text-text-muted text-xs mt-4">
            Powered by Supabase Auth · Google OAuth · No data shared with third
            parties
          </p>
        </div>
      </section>
    </main>
  );
}
