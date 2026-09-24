import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "../components/Header";
import { Button } from "../components/Button";
import { ComposeModal } from "../components/ComposeModal";
import { EmailTable } from "../components/EmailTable";
import { useToast } from "../components/Toast";
import { api, clearToken, decodeToken, getToken } from "../lib/api";
import type { AuthUser, EmailJob, SearchHit, SlackStatus } from "../types";

type Tab = "scheduled" | "sent";

function SlackConnectButton({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<SlackStatus | null>(null);

  const refresh = useCallback(() => {
    api.slack
      .status()
      .then(setStatus)
      .catch(() => setStatus({ connected: false }));
  }, []);

  useEffect(() => refresh(), [refresh]);

  async function connect() {
    try {
      const { url } = await api.slack.connect();
      window.location.assign(url);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to start Slack OAuth.");
    }
  }

  async function disconnect() {
    try {
      await api.slack.disconnect();
      setStatus({ connected: false });
      onChanged();
    } catch {
      // ignore
    }
  }

  if (status?.connected) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-300">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        Slack: {status.teamName}
        <button onClick={disconnect} className="ml-1 text-ink-400 underline hover:text-red-300">
          disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      className="inline-flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-xs font-medium text-ink-200 transition-colors hover:bg-ink-700"
    >
      {/* Slack glyph */}
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <path fill="#36C5F0" d="M6 3.5c-.9 0-1.6.7-1.6 1.6S5.1 6.7 6 6.7h1.6V5.1c0-.9-.7-1.6-1.6-1.6zM6 10.4H3.2c-.9 0-1.6.7-1.6 1.6s.7 1.6 1.6 1.6H6c.9 0 1.6-.7 1.6-1.6 0-.9-.7-1.6-1.6-1.6z" />
        <path fill="#2EB67D" d="M19.2 10.4c-.9 0-1.6.7-1.6 1.6v1.6h1.6c.9 0 1.6-.7 1.6-1.6s-.7-1.6-1.6-1.6zM14.4 10.4V5.1c0-.9-.7-1.6-1.6-1.6s-1.6.7-1.6 1.6v5.3c0 .9.7 1.6 1.6 1.6s1.6-.7 1.6-1.6z" />
        <path fill="#ECB22E" d="M14.4 19.2c.9 0 1.6-.7 1.6-1.6s-.7-1.6-1.6-1.6h-1.6v1.6c0 .9.7 1.6 1.6 1.6zM10.4 14.4H5.1c-.9 0-1.6.7-1.6 1.6s.7 1.6 1.6 1.6h5.3c.9 0 1.6-.7 1.6-1.6s-.7-1.6-1.6-1.6z" />
        <path fill="#E01E5A" d="M13.6 6c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6v1.6h-1.6c-.9 0-1.6-.7-1.6-1.6zM9.6 6c0 .9.7 1.6 1.6 1.6h1.6V5.1c0-.9-.7-1.6-1.6-1.6s-1.6.7-1.6 1.6z" />
      </svg>
      Connect Slack
      <span className="text-[10px] text-ink-500">(rate-limit alerts)</span>
    </button>
  );
}

export function DashboardPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tab, setTab] = useState<Tab>("scheduled");
  const [composeOpen, setComposeOpen] = useState(false);

  const [scheduled, setScheduled] = useState<EmailJob[]>([]);
  const [scheduledTotal, setScheduledTotal] = useState(0);
  const [scheduledLoading, setScheduledLoading] = useState(true);

  const [sent, setSent] = useState<EmailJob[]>([]);
  const [sentTotal, setSentTotal] = useState(0);
  const [sentLoading, setSentLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      window.location.assign("/login");
      return;
    }
    const decoded = decodeToken(token);
    if (!decoded) {
      window.location.assign("/login");
      return;
    }
    setUser(decoded);
  }, []);

  useEffect(() => {
    if (user) {
      void refreshScheduled();
      void refreshSent();
    }
  }, [user]);

  async function refreshScheduled() {
    setScheduledLoading(true);
    try {
      const res = await api.emails.scheduled();
      setScheduled(res.data);
      setScheduledTotal(res.total);
    } catch {
      setScheduled([]);
      setScheduledTotal(0);
    } finally {
      setScheduledLoading(false);
    }
  }

  async function refreshSent() {
    setSentLoading(true);
    try {
      const res = await api.emails.sent();
      setSent(res.data);
      setSentTotal(res.total);
    } catch {
      setSent([]);
      setSentTotal(0);
    } finally {
      setSentLoading(false);
    }
  }

  useEffect(() => {
    if (!search.trim()) {
      setSearchResults([]);
      return;
    }
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.search.emails(search.trim(), 0, 50);
        setSearchResults(res.hits);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const searchingResult = search.trim().length > 0;

  function logout() {
    clearToken();
    window.location.assign("/login");
  }

  const handleScheduledOrReload = useCallback(() => {
    void refreshScheduled();
    void refreshSent();
  }, []);

  const tabBtn = (id: Tab, label: string, count: number | null) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={`relative rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
        tab === id ? "bg-brand-600/15 text-brand-300" : "text-ink-400 hover:text-ink-200"
      }`}
    >
      {label}
      {count !== null && (
        <span className="ml-2 rounded-full bg-ink-700 px-2 py-0.5 text-[11px] text-ink-300">{count}</span>
      )}
    </button>
  );

  const searchSummary = useMemo(() => {
    if (!searchingResult) return null;
    if (searching) return <div className="text-xs text-ink-400">Searching…</div>;
    if (searchResults.length === 0) return <div className="text-xs text-ink-400">No matches for “{search}”.</div>;
    return (
      <div className="text-xs text-ink-300">
        {searchResults.length} match{searchResults.length === 1 ? "" : "es"} for “{search}”
      </div>
    );
  }, [searchingResult, searching, searchResults, search]);

  return (
    <div className="min-h-full">
      <Header user={user ?? { sub: "", email: "", name: "", avatar: null }} onLogout={logout}>
        <div className="flex items-center gap-3">
          <SlackConnectButton onChanged={handleScheduledOrReload} />
        </div>
      </Header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3">
            <svg className="h-5 w-5 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sent & scheduled emails (Elasticsearch)…"
              className="w-64 bg-transparent text-sm text-ink-100 placeholder-ink-400 focus:outline-none sm:w-80"
            />
          </div>

          <Button size="lg" onClick={() => setComposeOpen(true)}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M12 5v14M5 12h14" />
            </svg>
            Compose New Email
          </Button>
        </div>

        {searchSummary && <div className="mb-4">{searchSummary}</div>}
        {searchingResult && searchResults.length > 0 && (
          <div className="mb-6">
            <div className="overflow-hidden rounded-xl border border-ink-700">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Subject</th>
                    <th className="px-4 py-3 font-medium">Sent</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-700/70 bg-ink-850/60">
                  {searchResults.map((h) => (
                    <tr key={h.jobId} className="transition-colors hover:bg-ink-800/60">
                      <td className="max-w-[200px] truncate px-4 py-3 text-ink-200">{h.recipient}</td>
                      <td className="max-w-[240px] truncate px-4 py-3 text-ink-300">{h.subject}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-400">
                        {h.sentAt ? new Date(h.sentAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-ink-700 px-2.5 py-0.5 text-xs text-ink-300">{h.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mb-4 flex items-center gap-1 rounded-xl border border-ink-700 bg-ink-850 p-1">
          {tabBtn("scheduled", "Scheduled Emails", scheduledTotal)}
          {tabBtn("sent", "Sent Emails", sentTotal)}
        </div>

        {tab === "scheduled" ? (
          <EmailTable
            loading={scheduledLoading}
            rows={scheduled}
            total={scheduledTotal}
            timeColumn="scheduled"
            emptyTitle="No scheduled emails yet"
            emptyDescription="Compose your first email campaign and schedule delivery in the future."
            onEmptyAction={
              <Button onClick={() => setComposeOpen(true)}>Compose New Email</Button>
            }
          />
        ) : (
          <EmailTable
            loading={sentLoading}
            rows={sent}
            total={sentTotal}
            timeColumn="sent"
            emptyTitle="No emails sent yet"
            emptyDescription="Once scheduled emails go out, they will show up here with their delivery status."
          />
        )}
      </main>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onScheduled={handleScheduledOrReload}
      />
    </div>
  );
}