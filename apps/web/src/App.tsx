import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./features/app/AppShell";
import { AuthCallbackPage } from "./features/auth/AuthCallbackPage";
import { ProtectedRoute } from "./features/auth/ProtectedRoute";
import { LandingPage } from "./features/landing/LandingPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      />
      <Route
        path="/app/conversations/:conversationId"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
