import { useEffect } from "react";
import { setToken } from "../lib/api";

/**
 * Landing page for the Google OAuth redirect back from the backend.
 * The backend appends ?token=... — we persist it and do a full redirect so
 * the app re-boots with the token already in localStorage (avoids a router
 * render firing RequireAuth before the token write is visible).
 */
export function AuthRedirect() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const error = params.get("error");
    if (token) {
      setToken(token);
      window.location.replace("/dashboard");
    } else {
      window.location.replace(error ? `/login?error=${encodeURIComponent(error)}` : "/login");
    }
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-900 text-ink-400">
      Signing you in…
    </div>
  );
}