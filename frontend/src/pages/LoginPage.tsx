import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { api } from "../lib/api";
import { setToken } from "../lib/api";

export function LoginPage() {
  const [demoing, setDemoing] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "google_denied") {
      // Show inline hint if Google flow was cancelled.
    }
  }, []);

  async function handleDemo() {
    setDemoing(true);
    try {
      const res = await api.auth.demo();
      setToken(res.token);
      window.location.assign("/dashboard");
    } catch {
      setDemoing(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-900 px-4">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-brand-600/20 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/favicon.svg" alt="ReachInbox" className="mx-auto mb-4 h-14 w-14" />
          <h1 className="text-2xl font-bold text-ink-100">ReachInbox</h1>
          <p className="mt-1 text-sm text-ink-400">Schedule cold outreach emails at scale</p>
        </div>

        <div className="rounded-2xl border border-ink-700 bg-ink-850 p-6 shadow-2xl">
          <Button onClick={() => api.auth.login()} size="lg" className="w-full">
            <GoogleIcon />
            Continue with Google
          </Button>

          <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-ink-500">
            <span className="h-px flex-1 bg-ink-700" /> or <span className="h-px flex-1 bg-ink-700" />
          </div>

          <Button variant="secondary" size="lg" className="w-full" onClick={handleDemo} loading={demoing}>
            Use demo account (no Google)
          </Button>

          <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-500">
            Google login is the real OAuth 2.0 flow. The demo button is only enabled when{" "}
            <code className="rounded bg-ink-800 px-1 text-brand-300">AUTH_DEMO_MODE=true</code>.
          </p>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 48 48">
      <path
        fill="#FFC107"
        d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.4 6.1 29.5 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.4 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.7l6.2 5.2C38.6 36.9 44 32 44 24c0-1.3-.1-2.6-.4-3.9z"
      />
    </svg>
  );
}