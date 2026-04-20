import type { PropsWithChildren, ReactNode } from "react";

export function Panel({
  children,
  title,
  subtle = false
}: PropsWithChildren<{ title?: string; subtle?: boolean }>) {
  return (
    <section
      style={{
        borderRadius: "24px",
        border: subtle ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(126,180,255,0.14)",
        background: subtle ? "rgba(255,255,255,0.025)" : "rgba(10,14,20,0.72)",
        padding: "20px",
        boxShadow: subtle ? "none" : "0 18px 60px rgba(0,0,0,0.28)"
      }}
    >
      {title ? <p style={{ marginTop: 0, color: "#8fa7c3", textTransform: "uppercase", letterSpacing: "0.12em", fontSize: "0.75rem" }}>{title}</p> : null}
      {children}
    </section>
  );
}

export function SectionTitle({ children }: PropsWithChildren) {
  return (
    <h2 style={{ margin: "0 0 10px", fontSize: "1rem", color: "#f5f8fc" }}>
      {children}
    </h2>
  );
}

export function StatusBadge({
  children,
  tone = "warning"
}: PropsWithChildren<{ tone?: "success" | "warning" | "danger"; children: ReactNode }>) {
  const palette = {
    success: { bg: "rgba(69, 207, 141, 0.15)", fg: "#90f0b3" },
    warning: { bg: "rgba(255, 196, 88, 0.16)", fg: "#ffd98d" },
    danger: { bg: "rgba(255, 112, 112, 0.15)", fg: "#ff9c9c" }
  }[tone];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 12px",
        borderRadius: "999px",
        background: palette.bg,
        color: palette.fg,
        fontSize: "0.85rem"
      }}
    >
      {children}
    </span>
  );
}
