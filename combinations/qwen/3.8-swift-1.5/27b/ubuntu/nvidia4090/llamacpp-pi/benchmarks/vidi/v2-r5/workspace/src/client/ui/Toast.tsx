// src/client/ui/Toast.tsx
// Bottom-centre toast with role=status, auto-dismiss.

import { useEffect, useState, useCallback } from 'react';
import type { ReactElement } from 'react';

export interface ToastProps {
  message: string;
  onDismiss?: () => void;
  duration?: number;
}

export function Toast({ message, onDismiss, duration = 4000 }: ToastProps): ReactElement {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [visible, duration, onDismiss]);

  if (!visible) return <div />;

  return (
    <div
      role="status"
      data-testid="toast"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#323232',
        color: 'white',
        padding: '10px 20px',
        borderRadius: 8,
        fontSize: 14,
        zIndex: 10000,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}
    >
      {message}
    </div>
  );
}

/**
 * Hook that manages a single toast message.
 * Returns the current message (or null) and a show function.
 */
export function useToast(): { message: string | null; show: (msg: string) => void; dismiss: () => void } {
  const [message, setMessage] = useState<string | null>(null);

  const show = useCallback((msg: string) => {
    setMessage(msg);
  }, []);

  const dismiss = useCallback(() => {
    setMessage(null);
  }, []);

  return { message, show, dismiss };
}

/**
 * Renders the toast if there is a message.
 */
export function ToastContainer({ message, onDismiss }: { message: string | null; onDismiss: () => void }): ReactElement | null {
  if (!message) return null;
  return <Toast message={message} onDismiss={onDismiss} />;
}
