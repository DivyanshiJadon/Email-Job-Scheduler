import type { ReactNode } from "react";

export function EmptyState({
  icon = "📭",
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-ink-600 bg-ink-800/40 px-6 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-700 text-2xl">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-ink-100">{title}</h3>
      {description && <p className="max-w-sm text-sm text-ink-400">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}