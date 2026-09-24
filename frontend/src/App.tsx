import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import { getToken } from "./lib/api";
import { LoginPage } from "./pages/LoginPage";
import { AuthRedirect } from "./pages/AuthRedirect";
import { DashboardPage } from "./pages/DashboardPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to={getToken() ? "/dashboard" : "/login"} replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth" element={<AuthRedirect />} />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}