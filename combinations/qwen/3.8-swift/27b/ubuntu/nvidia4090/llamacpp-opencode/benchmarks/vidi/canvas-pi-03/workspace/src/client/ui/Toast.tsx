/**
 * Story 12: validation-failure toasts (image.insert: "short toast at the
 * bottom of the screen for refused files").
 *
 * A module-level emitter (`showToast`) + a single `<ToastHost/>` rendered
 * once by the Board. Toasts are `role="status"` (screen-reader + e2e) and
 * auto-dismiss after TOAST_DURATION_MS.
 */
import { useEffect, useState } from 'react';
import type { JSX } from 'react';

export const TOAST_DURATION_MS = 5000;

interface Toast {
  id: number;
  message: string;
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l(toasts);
}

/** Shows a toast at the bottom of the screen (idempotent for duplicates). */
export function showToast(message: string): void {
  if (toasts.some((t) => t.message === message)) return;
  const toast: Toast = { id: nextId++, message };
  toasts = [...toasts, toast];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== toast.id);
    emit();
  }, TOAST_DURATION_MS);
}

export function ToastHost(): JSX.Element {
  const [items, setItems] = useState<Toast[]>(toasts);
  useEffect(() => {
    const listener: Listener = (t) => setItems(t);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return (
    <div
      data-testid="toast-host"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        zIndex: 2000,
        pointerEvents: 'none',
      }}
    >
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          data-testid="toast"
          style={{
            padding: '8px 16px',
            backgroundColor: '#323232',
            color: '#ffffff',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            fontSize: 13,
            maxWidth: 480,
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
