import { useState, useEffect, useCallback, useRef } from 'react';
import { onToast, type ToastPayload, type ToastKind } from '../lib/toast';

const KIND_STYLES: Record<ToastKind, { bar: string; icon: string }> = {
  info:    { bar: 'bg-primary',  icon: 'ℹ' },
  success: { bar: 'bg-success',  icon: '✓' },
  warning: { bar: 'bg-warning',  icon: '⚠' },
  error:   { bar: 'bg-danger',   icon: '✕' },
};

interface ActiveToast extends ToastPayload {
  visible: boolean;
  /** TOAST-003: number of times this hash has fired while visible. */
  count: number;
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  // TOAST-003: track the auto-dismiss timer per toast id so duplicates can
  // restart it (the user just learned about a fresh occurrence — they shouldn't
  // lose the toast mid-flight).
  const dismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, visible: false } : t));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 300);
  }, []);

  useEffect(() => {
    return onToast((payload) => {
      setToasts(prev => {
        // TOAST-003: dedup by hash (kind + message). If a visible toast with
        // the same hash exists, bump its count and re-render it (new id so the
        // animation key changes — gives the user feedback that it re-fired).
        const hash = payload.hash ?? `${payload.kind}:${payload.message}`;
        const existing = prev.find(t => t.visible && (t.hash ?? `${t.kind}:${t.message}`) === hash);
        if (existing) {
          // Reset its auto-dismiss timer.
          const oldTimer = dismissTimers.current.get(existing.id);
          if (oldTimer) clearTimeout(oldTimer);
          const newId = payload.id;
          if (payload.duration !== 0) {
            const ms = payload.duration ?? 4000;
            const handle = setTimeout(() => dismiss(newId), ms);
            dismissTimers.current.set(newId, handle);
          }
          dismissTimers.current.delete(existing.id);
          return prev.map(t => t === existing
            ? { ...t, id: newId, count: t.count + 1, hash, duration: payload.duration }
            : t);
        }
        // New toast — schedule its auto-dismiss.
        if (payload.duration !== 0) {
          const ms = payload.duration ?? 4000;
          const handle = setTimeout(() => dismiss(payload.id), ms);
          dismissTimers.current.set(payload.id, handle);
        }
        return [...prev, { ...payload, hash, visible: true, count: 1 }];
      });
    });
  }, [dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map(t => {
        const s = KIND_STYLES[t.kind];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 bg-surface border border-border rounded-lg shadow-xl px-4 py-3 min-w-[280px] max-w-[420px] transition-all duration-300 ${
              t.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            role="alert"
          >
            <span className={`${s.bar} text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shrink-0 mt-0.5`}>
              {s.icon}
            </span>
            <span className="text-sm text-foreground flex-1 leading-snug">
              {t.message}
              {t.count > 1 && (
                <span
                  className="ml-2 text-[10px] font-mono text-muted bg-surface-high px-1 py-0.5 rounded"
                  aria-label={`Repeated ${t.count} times`}
                >
                  ×{t.count}
                </span>
              )}
            </span>
            <button
              onClick={() => dismiss(t.id)}
              className="text-muted hover:text-foreground text-sm shrink-0 cursor-pointer"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
