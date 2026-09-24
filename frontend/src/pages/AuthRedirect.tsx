import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { setToken } from "../lib/api";

/**
 * Landing page for the Google OAuth redirect back from the backend.
 * The backend appends ?token=... — we store it and go to the dashboard.
 */
export function AuthRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      setToken(token);
      navigate("/dashboard", { replace: true });
    } else {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-900 text-ink-400">
      Signing you in…
    </div>
  );
}