/**
 * Bottom toast for status messages (story 12, image.insert).
 *
 * Shows a short message at the bottom of the screen with role="status"
 * (announced politely by screen readers). Auto-dismisses.
 */

import { useCallback, useEffect, useState, type JSX } from 'react';
import { IMAGE_UPLOAD_STALE_MS } from '../../shared/config';

/**
 * A single toast message displayed at the bottom of the screen.
 */
export interface ToastMessage {
  id: number;
  text: string;
}

/**
 * Hook that manages a queue of toast messages.
 * Returns the current toast (or null) and a showToast callback.
 */
let toastIdCounter = 0;

export function useToasts(): { toasts: ToastMessage[]; showToast: (msg: string) => void } {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((msg: string): void => {
    const id = ++toastIdCounter;
    setToasts((prev) => [...prev, { id, text: msg }]);
    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return { toasts, showToast };
}

/**
 * Renders the toast container (bottom-centre).
 */
export function ToastContainer({ toasts }: { toasts: ToastMessage[] }): JSX.Element | null {
  if (toasts.length === 0) {
    return null;
  }
  return (
    <div
      data-testid="toast-container"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 5000,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid="toast"
          style={{
            padding: '8px 16px',
            background: '#333',
            color: '#fff',
            borderRadius: 6,
            fontSize: 14,
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            whiteSpace: 'nowrap',
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
