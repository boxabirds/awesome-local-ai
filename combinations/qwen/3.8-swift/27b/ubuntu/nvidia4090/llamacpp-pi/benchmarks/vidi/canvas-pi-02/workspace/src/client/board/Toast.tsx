// Toast stack (story 12, image.toasts): transient bottom-right notices for
// validation rejections, network errors and rate limiting. No new
// primitives — a fixed div with aria-live="polite" (role="status").
//
// Toasts expire after ~4 seconds; the stack caps at 3 visible entries.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export interface Toast {
  id: number;
  message: string;
}

const TOAST_TTL_MS = 4000;
const MAX_TOASTS = 3;

interface ToastApi {
  toasts: Toast[];
  /** Adds a toast (deduplicated against a still-visible identical one). */
  showToast: (message: string) => void;
}

let nextId = 1;

export function useToasts(): ToastApi {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (message: string) => {
      setToasts((prev) => {
        // Deduplicate a repeat of a visible toast; refresh its timer.
        const existing = prev.find((t) => t.message === message);
        if (existing) {
          const timer = timers.current.get(existing.id);
          if (timer !== undefined) clearTimeout(timer);
          timers.current.set(
            existing.id,
            setTimeout(() => dismiss(existing.id), TOAST_TTL_MS),
          );
          return prev;
        }
        const id = nextId++;
        timers.current.set(id, setTimeout(() => dismiss(id), TOAST_TTL_MS));
        const next = [...prev, { id, message }];
        // Cap the visible stack (oldest first).
        return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
      });
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return { toasts, showToast };
}

/** The fixed bottom-right stack. `role="status"` announces each entry once
 *  (image.toasts: no per-message aria-live duplication). */
export function ToastStack({ toasts }: { toasts: Toast[] }): ReactNode {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      role="status"
      aria-live="polite"
      data-testid="toast-stack"
    >
      {toasts.map((t) => (
        <div key={t.id} className="rounded bg-neutral-800 px-3 py-2 text-sm text-neutral-100 shadow" data-testid="toast">
          {t.message}
        </div>
      ))}
    </div>
  );
}
