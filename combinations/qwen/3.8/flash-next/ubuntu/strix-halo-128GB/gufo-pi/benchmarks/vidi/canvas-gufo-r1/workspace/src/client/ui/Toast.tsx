import { useCallback, useRef, useState } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
}

let nextToastId = 0;

export interface ToastState {
  toast: ToastMessage | null;
  showToast(text: string): void;
}

/**
 * Hook that manages a single toast message at the bottom of the screen.
 */
export function useToastState(): ToastState {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const id = ++nextToastId;
    setToast({ id, text });
    timerRef.current = setTimeout(() => {
      setToast((t) => (t?.id === id ? null : t));
    }, 5000);
  }, []);

  return { toast, showToast };
}

export interface ToastProps {
  toast: ToastMessage | null;
}

/**
 * Bottom-centre toast with role="status" for accessibility.
 */
export function Toast({ toast }: ToastProps) {
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="toast"
      className="toast-message"
    >
      {toast.text}
    </div>
  );
}
