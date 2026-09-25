import { useEffect } from 'react';

/** How long a toast stays on screen before it goes away by itself. */
export const TOAST_DURATION_MS = 5000;

export interface ToastProps {
  /** The lines to show; nothing is rendered for []. */
  messages: readonly string[];
  /** Changes with every new toast (restarts the timer even when the text is the same). */
  toastKey: number;
  onDismiss(): void;
}

/**
 * A short message at the bottom centre of the screen (story 12: refused files, offline, rate
 * limit). Announced politely (role=status); goes away after TOAST_DURATION_MS. The live region
 * is always present so screen readers announce text added to it.
 */
export function Toast({ messages, toastKey, onDismiss }: ToastProps) {
  useEffect(() => {
    if (messages.length === 0) return undefined;
    const timer = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [messages, toastKey, onDismiss]);

  return (
    <div className="toast-region" role="status" aria-live="polite" aria-label="Messages">
      {messages.length > 0 && (
        <div className="toast" data-testid="toast" key={toastKey}>
          {messages.map((m) => (
            <p key={m} className="toast__line">
              {m}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
