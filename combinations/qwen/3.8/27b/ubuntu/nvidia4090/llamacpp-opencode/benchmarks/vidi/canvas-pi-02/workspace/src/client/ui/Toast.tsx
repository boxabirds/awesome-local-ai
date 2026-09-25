/**
 * Bottom-centre toast (story 12, image.insert).
 *
 * A simple auto-dismissing status message with role="status" for
 * accessibility (announced politely by screen readers).
 */

import { useEffect, useState, useCallback } from 'react';
import type { JSX } from 'react';

const TOAST_DURATION_MS = 4000;

export interface ToastState {
  message: string | null;
  key: number; // increment to re-trigger the same message
}

export function useToast(): { toast: ToastState; showToast(message: string): void; dismissToast(): void } {
  const [toast, setToast] = useState<ToastState>({ message: null, key: 0 });

  const showToast = useCallback((message: string): void => {
    if (message === '') return; // empty message = no-op
    setToast((prev) => ({ message, key: prev.key + 1 }));
  }, []);

  const dismissToast = useCallback((): void => {
    setToast({ message: null, key: 0 });
  }, []);

  return { toast, showToast, dismissToast };
}

export function Toast({ message, onDismiss }: { message: string; onDismiss(): void }): JSX.Element {
  useEffect(() => {
    const timer = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      className="vidi6-toast"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        background: '#263238',
        color: '#fff',
        padding: '10px 20px',
        borderRadius: '8px',
        fontSize: '14px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        whiteSpace: 'nowrap',
      }}
    >
      {message}
    </div>
  );
}
