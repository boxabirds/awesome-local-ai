import { useEffect } from 'react';
import { TOAST_DURATION_MS } from '../../shared/config';

/**
 * Short message at the bottom of the screen (story 12: refused files, offline).
 * Announced politely (`role=status`); it goes away after TOAST_DURATION_MS or
 * when dismissed. Nothing is rendered without a message, so the page's other
 * status regions stay the only ones.
 */
export function Toast(props: { toast: { id: number; messages: readonly string[] } | null; onDismiss(): void }) {
  const { toast, onDismiss } = props;
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);
  if (!toast) return null;
  return (
    <div className="toast" role="status" data-testid="toast">
      <div>
        {toast.messages.map((m) => (
          <p key={m} className="toast-message">
            {m}
          </p>
        ))}
      </div>
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
