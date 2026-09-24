import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../types";

interface Props {
  user: AuthUser;
  onLogout: () => void;
  children?: ReactNode;
}

export function Header({ user, onLogout, children }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-40 border-b border-ink-700 bg-ink-850/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="ReachInbox" className="h-8 w-8" />
          <div className="leading-tight">
            <div className="text-sm font-bold text-ink-100">ReachInbox</div>
            <div className="text-[11px] text-ink-400">Email Job Scheduler</div>
          </div>
        </div>

        {children}

        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2.5 rounded-full border border-ink-700 bg-ink-800 py-1.5 pl-1.5 pr-3 transition-colors hover:bg-ink-700"
          >
            {user.avatar ? (
              <img src={user.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                {user.name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="hidden text-left sm:block">
              <span className="block max-w-[160px] truncate text-xs font-semibold text-ink-100">
                {user.name}
              </span>
              <span className="block max-w-[160px] truncate text-[11px] text-ink-400">{user.email}</span>
            </span>
            <svg className="h-4 w-4 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-ink-600 bg-ink-850 shadow-xl">
                <div className="border-b border-ink-700 px-4 py-3">
                  <div className="truncate text-sm font-semibold text-ink-100">{user.name}</div>
                  <div className="truncate text-xs text-ink-400">{user.email}</div>
                </div>
                <button
                  onClick={() => {
                    navigate("/admin/queues");
                  }}
                  className="block w-full px-4 py-2.5 text-left text-sm text-ink-300 transition-colors hover:bg-ink-700"
                >
                  BullMQ dashboard
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout();
                  }}
                  className="block w-full px-4 py-2.5 text-left text-sm text-red-300 transition-colors hover:bg-red-900/30"
                >
                  Log out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}