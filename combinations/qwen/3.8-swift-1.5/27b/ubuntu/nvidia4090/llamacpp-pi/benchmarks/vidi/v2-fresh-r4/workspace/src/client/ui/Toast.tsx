/**
 * Bottom toast notification (story 12): short message at the bottom of the
 * screen with role=status for accessibility. Auto-dismisses.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';

const TOAST_DURATION_MS = 4000;

export interface ToastProps {
  message: string | null;
  onDismiss?(): void;
}

/**
 * A simple toast that appears at the bottom centre of the screen.
 * Shows the message with role="status" for screen readers.
 * Auto-dismisses after TOAST_DURATION_MS.
 */
export function Toast({ message, onDismiss }: ToastProps): JSX.Element | null {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (message) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        onDismiss?.();
      }, TOAST_DURATION_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [message, onDismiss]);

  if (!message || !visible) return null;

  return (
    <div
      className="toast"
      data-vidi6="toast"
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}

/**
 * Hook to manage a single toast message.
 * Returns the current message and a show() function.
 */
export function useToast(): { message: string | null; show(msg: string): void; dismiss(): void } {
  const [message, setMessage] = useState<string | null>(null);

  const show = useCallback((msg: string) => {
    setMessage(msg);
  }, []);

  const dismiss = useCallback(() => {
    setMessage(null);
  }, []);

  return { message, show, dismiss };
}
