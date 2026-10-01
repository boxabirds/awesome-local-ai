/**
 * Bottom-centre toast notification with role=status for screen readers.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastItem {
  id: number;
  message: string;
}

let nextToastId = 1;

export interface ToastState {
  toasts: readonly ToastItem[];
  show(message: string): void;
}

export function useToastState(): ToastState {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const show = useCallback((message: string) => {
    const id = nextToastId++;
    setToasts((prev) => [...prev, { id, message }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(id);
    }, 5000);
    timersRef.current.set(id, timer);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  return { toasts, show };
}

export function Toast({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="toast" role="status" aria-live="polite" data-testid="toast">
      {message}
    </div>
  );
}

export function ToastContainer({ toasts }: { toasts: readonly ToastItem[] }): React.JSX.Element | null {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container" data-testid="toast-container">
      {toasts.map((t) => (
        <Toast key={t.id} message={t.message} />
      ))}
    </div>
  );
}
