import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  type: "success" | "error" | "info";
  message: string;
}

const ToastCtx = createContext<{ push: (type: Toast["type"], message: string) => void }>({
  push: () => undefined,
});

export function useToast() {
  return useContext(ToastCtx).push;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const push = useCallback((type: Toast["type"], message: string) => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
              t.type === "success"
                ? "border-emerald-500/40 bg-emerald-950/80 text-emerald-200"
                : t.type === "error"
                  ? "border-red-500/40 bg-red-950/80 text-red-200"
                  : "border-sky-500/40 bg-sky-950/80 text-sky-200"
            }`}
          >
            <span className="mt-0.5">{t.type === "success" ? "✅" : t.type === "error" ? "⚠️" : "ℹ️"}</span>
            <span className="flex-1">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}