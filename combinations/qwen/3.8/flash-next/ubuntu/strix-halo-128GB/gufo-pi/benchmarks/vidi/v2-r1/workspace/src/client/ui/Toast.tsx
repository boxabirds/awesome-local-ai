/**
 * Bottom-centre toast with `role=status` for status messages (story 12).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastItem {
  id: number;
  message: string;
}

export interface ToastProps {
  /** Messages to display. Set by callers via useToast(). */
  toasts: readonly ToastItem[];
  /** Called when a toast should be dismissed (unused today; reserved). */
  onDismiss?(id: number): void;
}

export function Toast({ toasts }: ToastProps): React.JSX.Element | null {
  if (toasts.length === 0) return null;

  return (
    <div
      data-testid="toast-container"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid="toast"
          style={{
            backgroundColor: '#333',
            color: '#fff',
            padding: '8px 16px',
            borderRadius: 6,
            fontSize: 14,
            maxWidth: 400,
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

let nextToastId = 1;

/**
 * Hook that manages toast state. Returns a `push(message)` function and the
 * current toasts array + onDismiss for rendering with `<Toast />`.
 */
export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback((message: string) => {
    const id = nextToastId++;
    setToasts((prev) => [...prev, { id, message }]);
    const timer = setTimeout(() => dismiss(id), 4000);
    timersRef.current.set(id, timer);
  }, [dismiss]);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
    };
  }, []);

  return { toasts, push, dismiss };
}
