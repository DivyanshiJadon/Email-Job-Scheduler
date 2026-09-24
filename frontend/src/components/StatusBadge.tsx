import type { EmailStatus } from "../types";

const styles: Record<EmailStatus, string> = {
  scheduled: "bg-brand-500/15 text-brand-300 ring-brand-400/30",
  deferred: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
  processing: "bg-sky-500/15 text-sky-300 ring-sky-400/30",
  sent: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  failed: "bg-red-500/15 text-red-300 ring-red-400/30",
};

const labels: Record<EmailStatus, string> = {
  scheduled: "Scheduled",
  deferred: "Deferred",
  processing: "Sending…",
  sent: "Sent",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}