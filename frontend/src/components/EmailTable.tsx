import type { EmailJob } from "../types";
import { StatusBadge } from "./StatusBadge";
import { EmptyState } from "./EmptyState";
import { Spinner } from "./Button";

export interface EmailTableProps {
  loading: boolean;
  rows: EmailJob[];
  total: number;
  timeColumn: "scheduled" | "sent";
  emptyTitle: string;
  emptyDescription?: string;
  onEmptyAction?: React.ReactNode;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function EmailTable({
  loading,
  rows,
  total,
  timeColumn,
  emptyTitle,
  emptyDescription,
  onEmptyAction,
}: EmailTableProps) {
  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center gap-3 text-ink-400">
        <Spinner /> Loading emails…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={onEmptyAction}
      />
    );
  }

  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-wider text-ink-400">
        {total} email{total === 1 ? "" : "s"}
      </div>
      <div className="overflow-hidden rounded-xl border border-ink-700">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Subject</th>
              <th className="px-4 py-3 font-medium">
                {timeColumn === "scheduled" ? "Scheduled time" : "Sent time"}
              </th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700/70 bg-ink-850/60">
            {rows.map((row) => (
              <tr key={row.id} className="transition-colors hover:bg-ink-800/60">
                <td className="max-w-[200px] truncate px-4 py-3 text-ink-200">
                  {row.recipient}
                </td>
                <td className="max-w-[240px] truncate px-4 py-3 text-ink-300">
                  {row.subject}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-300">
                  {formatDateTime(timeColumn === "scheduled" ? row.scheduledAt : row.sentAt)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}