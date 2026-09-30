import { useCallback, useRef, useState, type ReactElement } from 'react';

interface ToastState {
  id: number;
  message: string;
}

let toastId = 0;

/**
 * Simple toast notification system. Shows a bottom-centre toast with role=status.
 * Auto-dismisses after 4 seconds.
 */
export function useToast(): { toasts: ToastState[]; showToast(message: string): void } {
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const showToast = useCallback((message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(id);
    }, 4000);
    timersRef.current.set(id, timer);
  }, []);

  return { toasts, showToast };
}

export function ToastContainer({ toasts }: { toasts: ToastState[] }): ReactElement | null {
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 1000,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          aria-live="polite"
          style={{
            padding: '10px 20px',
            background: '#1f2937',
            color: '#ffffff',
            borderRadius: 8,
            fontSize: 14,
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
