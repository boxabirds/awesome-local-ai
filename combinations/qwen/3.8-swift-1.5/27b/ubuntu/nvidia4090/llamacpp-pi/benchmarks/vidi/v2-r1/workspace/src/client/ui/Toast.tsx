/**
 * Story 12: toast stack (image.insert).
 *
 * role="status" aria-live="polite" (PRD a11y). Toasts auto-dismiss after
 * TOAST_TTL_MS; the stack is fixed, bottom-centre, above the canvas.
 */
import { useCallback, useRef, useState } from 'react';

export interface Toast {
  id: number;
  message: string;
}

const TOAST_TTL_MS = 5000;

/**
 * Returns the current toast list plus a `push` function. Each toast
 * auto-removes after 5s.
 */
export function useToasts(): { toasts: Toast[]; push: (message: string) => void } {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const push = useCallback((message: string) => {
    const id = ++nextId.current;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_TTL_MS);
  }, []);

  return { toasts, push };
}

export function ToastStack({ toasts }: { toasts: Toast[] }): React.ReactElement | null {
  if (toasts.length === 0) return null;
  return (
    <div
      role="status"
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
        zIndex: 2001,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid="toast"
          style={{
            background: '#1f2937',
            color: '#fff',
            padding: '8px 16px',
            borderRadius: 8,
            fontSize: 14,
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            maxWidth: 420,
            textAlign: 'center',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
