import type { PropsWithChildren, ReactNode } from "react";

/* ──────────────────────────────────────────────────────────────
   Panel — Glass container with optional title and sticky header
   ────────────────────────────────────────────────────────────── */

export function Panel({
  children,
  title,
  subtle = false,
  className = "",
}: PropsWithChildren<{ title?: string; subtle?: boolean; className?: string }>) {
  return (
    <section
      className={`rounded-xl p-5 ${
        subtle
          ? "bg-[rgba(255,255,255,0.025)] border border-border-subtle"
          : "bg-bg-surface-1 border border-border-subtle shadow-[0_18px_60px_rgba(0,0,0,0.28)]"
      } ${className}`}
    >
      {title ? (
        <p className="mt-0 mb-3 text-text-muted text-xs font-medium uppercase tracking-widest">
          {title}
        </p>
      ) : null}
      {children}
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────
   SectionTitle
   ────────────────────────────────────────────────────────────── */

export function SectionTitle({ children }: PropsWithChildren) {
  return (
    <h2 className="mt-0 mb-2.5 text-base font-semibold text-text-primary">
      {children}
    </h2>
  );
}

/* ──────────────────────────────────────────────────────────────
   StatusBadge — Toned pill badge with optional dot animation
   ────────────────────────────────────────────────────────────── */

const BADGE_TONES = {
  success: "bg-surface-success text-accent-green",
  warning: "bg-surface-warning text-accent-amber",
  danger: "bg-surface-danger text-accent-red",
  neutral: "bg-[rgba(255,255,255,0.06)] text-text-secondary",
} as const;

export function StatusBadge({
  children,
  tone = "warning",
  pulse = false,
}: PropsWithChildren<{
  tone?: keyof typeof BADGE_TONES;
  pulse?: boolean;
  children: ReactNode;
}>) {
  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${BADGE_TONES[tone]}`}
    >
      {pulse ? (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse-dot" />
      ) : null}
      {children}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────
   EmptyState — Centered placeholder with heading + description
   ────────────────────────────────────────────────────────────── */

export function EmptyState({
  heading,
  description,
  children,
}: {
  heading: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-6 text-center animate-fade-in">
      <p className="text-text-secondary font-medium text-sm mb-1">{heading}</p>
      {description ? (
        <p className="text-text-muted text-xs max-w-[280px] leading-relaxed mb-4">
          {description}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   LoadingSpinner — CSS-only accessible spinner
   ────────────────────────────────────────────────────────────── */

export function LoadingSpinner({ size = 20 }: { size?: number }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className="inline-block rounded-full border-2 border-border-subtle border-t-accent-teal animate-spin-slow"
      style={{ width: size, height: size }}
    />
  );
}

/* ──────────────────────────────────────────────────────────────
   LatencyBar — Horizontal bar for latency breakdown display
   ────────────────────────────────────────────────────────────── */

export function LatencyBar({
  label,
  valueMs,
  maxMs,
}: {
  label: string;
  valueMs: number | undefined;
  maxMs: number;
}) {
  const width =
    valueMs != null && maxMs > 0 ? Math.min((valueMs / maxMs) * 100, 100) : 0;
  const display = valueMs != null ? `${Math.round(valueMs)} ms` : "—";

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-text-secondary w-28 shrink-0 text-right">
        {label}
      </span>
      <div className="flex-1 h-2 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${width}%`,
            background:
              "linear-gradient(90deg, var(--color-accent-teal), var(--color-accent-blue))",
          }}
        />
      </div>
      <span className="text-text-muted font-mono w-16 text-right">
        {display}
      </span>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   IconButton — Ghost button for toolbars
   ────────────────────────────────────────────────────────────── */

export function IconButton({
  children,
  onClick,
  label,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center w-8 h-8 rounded-lg
                 text-text-secondary hover:text-text-primary
                 hover:bg-[rgba(255,255,255,0.06)]
                 transition-colors duration-150
                 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}
