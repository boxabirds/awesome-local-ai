// Toast notifications (see spec: image.insert, image.upload_failure).
//
// Bottom-of-screen toasts, auto-dismissing after TOAST_DURATION_MS.
// role="status" so screen readers announce them without moving focus.

import { useCallback, useRef, useState, type JSX } from 'react';
import { TOAST_DURATION_MS } from '../../shared/config';

export interface ToastItem {
  id: number;
  message: string;
}

export interface Toasts {
  toasts: ToastItem[];
  /** Push a message; it disappears after TOAST_DURATION_MS. */
  push(message: string): void;
}

/** The toast list + push action for one surface (the board). */
export function useToasts(): Toasts {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  return { toasts, push };
}

export function ToastStack({ toasts }: { toasts: readonly ToastItem[] }): JSX.Element | null {
  if (toasts.length === 0) return null;
  return (
    <div data-testid="toast-stack" className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} data-testid="toast" className="toast" role="status">
          {t.message}
        </div>
      ))}
    </div>
  );
}
