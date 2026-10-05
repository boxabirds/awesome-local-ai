/**
 * Bottom-centre toast notification (story 12).
 *
 * Uses role=status for polite screen-reader announcements.
 */
import { useCallback, useRef, useState } from 'react';

export interface ToastState {
  message: string;
  id: number;
}

let nextId = 0;

export interface ToastApi {
  show(message: string): void;
}

export function useToast(): { ToastComponent: () => React.ReactNode; api: ToastApi } {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((message: string) => {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    const id = ++nextId;
    setToast({ message, id });
    timerRef.current = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, 5000);
  }, []);

  const ToastComponent = useCallback(() => {
    if (!toast) return null;
    return (
      <div className="toast" role="status" data-toast="" aria-live="polite">
        {toast.message}
      </div>
    );
  }, [toast]);

  return { ToastComponent, api: { show } };
}
