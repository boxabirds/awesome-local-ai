/**
 * Toast notification: a short message at the bottom of the screen, role=status, auto-dismisses.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export interface ToastState {
  message: string;
  key: number;
}

let toastKey = 0;

export interface UseToastResult {
  toast: ToastState | null;
  showToast(message: string): void;
}

export function useToast(durationMs = 4000): UseToastResult {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    toastKey += 1;
    setToast({ message, key: toastKey });
    timerRef.current = setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, durationMs);
  }, [durationMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return { toast, showToast };
}

export interface ToastProps {
  toast: ToastState | null;
}

export function Toast({ toast }: ToastProps) {
  if (!toast) return null;
  return (
    <div
      className="toast-notification"
      data-testid="toast"
      role="status"
      aria-live="polite"
      key={toast.key}
    >
      {toast.message}
    </div>
  );
}
