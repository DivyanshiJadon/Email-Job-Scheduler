import type { TextareaHTMLAttributes } from "react";

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function TextArea({ label, hint, error, className = "", ...rest }: Props) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-ink-300">{label}</span>}
      <textarea
        className={`w-full rounded-lg border bg-ink-800 px-3 py-2 text-sm text-ink-100 placeholder-ink-400 transition-colors focus:outline-none focus:ring-2 ${
          error
            ? "border-red-500/60 focus:ring-red-400/40"
            : "border-ink-600 focus:border-brand-400 focus:ring-brand-400/30"
        } ${className}`}
        {...rest}
      />
      {error ? (
        <span className="mt-1 block text-xs text-red-400">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-400">{hint}</span>
      ) : null}
    </label>
  );
}