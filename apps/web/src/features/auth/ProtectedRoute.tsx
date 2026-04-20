import type { PropsWithChildren } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export function ProtectedRoute({ children }: PropsWithChildren) {
  const { loading, session } = useAuth();

  if (loading) {
    return <div className="app-shell-loading">Checking your session…</div>;
  }

  if (!session) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
