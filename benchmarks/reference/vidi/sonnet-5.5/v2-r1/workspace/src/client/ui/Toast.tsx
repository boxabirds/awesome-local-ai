import { useEffect } from 'react';
import { TOAST_DURATION_MS } from '../../shared/config';

/** Short message at the bottom of the screen; announced politely and dismissed automatically. */
export function Toast({ message, onDismiss }: { message: string | null; onDismiss(): void }) {
  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);
  return (
    <div className="toast-region" role="status" aria-live="polite" data-testid="toast">
      {message !== null && <div className="toast">{message}</div>}
    </div>
  );
}
