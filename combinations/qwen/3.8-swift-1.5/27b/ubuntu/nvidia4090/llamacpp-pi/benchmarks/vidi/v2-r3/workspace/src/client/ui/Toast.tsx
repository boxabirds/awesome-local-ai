import { useCallback, useEffect, useRef, useState } from 'react';

export interface Toast {
  id: number;
  message: string;
}

let toastId = 0;

/**
 * Simple toast system: a bottom-centre toast with role=status.
 * Auto-dismisses after 4 seconds.
 */
export function useToast(): { toasts: Toast[]; show(message: string): void } {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const show = useCallback((message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(id);
    }, 4000);
    timersRef.current.set(id, timer);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  return { toasts, show };
}

/**
 * Render the toasts at the bottom of the screen.
 */
export function ToastContainer({ toasts }: { toasts: Toast[] }): React.ReactElement | null {
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
        zIndex: 100,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          data-testid="toast"
          style={{
            background: '#323232',
            color: '#fff',
            padding: '10px 20px',
            borderRadius: 8,
            fontSize: 14,
            boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
            whiteSpace: 'nowrap',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
