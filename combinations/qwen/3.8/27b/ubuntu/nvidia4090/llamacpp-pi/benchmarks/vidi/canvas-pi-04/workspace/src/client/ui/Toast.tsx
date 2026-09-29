// Story 12: the bottom toast (anchor: image.insert / image.offline / image.rate_limit).
//
// A minimal, self-dismissing toast stack used to surface image-insertion
// feedback (rejection reasons, offline, rate limit). Toasts are non-blocking
// and announced to assistive tech via role="status" / aria-live. The
// `useToasts` hook owns the list and the auto-dismiss timers; `Toasts` renders
// it. Kept free of board/Yjs coupling so other stories can reuse it.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

export type ToastKind = 'error' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  kind: ToastKind;
}

/**
 * Own a list of auto-dismissing toasts. `push` appends a toast and schedules
 * its removal after `timeoutMs`. Returns the current list and `push`.
 */
export function useToasts(timeoutMs = 5000): {
  toasts: readonly ToastItem[];
  push: (message: string, kind?: ToastKind) => void;
} {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message: string, kind: ToastKind = 'error'): void => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, message, kind }]);
      const timer = setTimeout(() => dismiss(id), timeoutMs);
      timers.current.set(id, timer);
    },
    [dismiss, timeoutMs],
  );

  // Clear any pending timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  return { toasts, push };
}

/** Render a toast stack (empty renders nothing). */
export function Toasts({ toasts }: { toasts: readonly ToastItem[] }): JSX.Element | null {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} data-testid="toast">
          {t.message}
        </div>
      ))}
    </div>
  );
}
