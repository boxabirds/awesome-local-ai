import { useEffect } from 'react';
import { TOAST_DURATION_MS } from '../../shared/config';

export interface ToastMessage {
  /** Changes for every new toast (restarts the timer even when the texts repeat). */
  id: number;
  lines: readonly string[];
}

/**
 * Short message at the bottom centre of the screen, announced politely (role=status). Dismisses itself after
 * TOAST_DURATION_MS. The live region is always rendered so screen readers pick up new messages.
 */
export function Toast(props: { message: ToastMessage | null; onDismiss(): void }) {
  const { message, onDismiss } = props;
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(t);
  }, [message, onDismiss]);
  return (
    <div className={`toast${message ? ' toast--visible' : ''}`} role="status" aria-live="polite" data-testid="toast">
      {message?.lines.map((line) => (
        <p key={line} className="toast__line">
          {line}
        </p>
      ))}
    </div>
  );
}
