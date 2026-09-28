// The board's bottom toast (story 12, design `image.insert`). One small,
// self-dismissing strip that shows the product's exact refusal words - "Only PNG,
// JPEG, GIF and WebP images can be added.", "Images must be 10 MB or smaller.", and
// so on - so a file that could not be added explains itself instead of silently
// vanishing (images.types, images.size_limit, images.count_limit, images.offline,
// images.rate_limit).
//
// It is a live region (`role="status"`), so a screen reader reads a new message
// without stealing focus, and each message carries a stable key so the list can
// grow and shrink without messages flickering. It draws nothing when there is
// nothing to say.
import type React from 'react';

export interface ToastProps {
  /** the messages to show, oldest first */
  messages: readonly string[];
  /** ask for one message to be dropped (its "dismiss", or after it ages out) */
  onDismiss?(message: string): void;
}

export function Toast({ messages, onDismiss }: ToastProps): React.JSX.Element | null {
  if (messages.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="toast"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        zIndex: 40,
        fontFamily: 'system-ui, sans-serif',
        maxWidth: '90vw',
      }}
    >
      {messages.map((message, i) => (
        <div
          key={`${i}:${message}`}
          data-testid="toast-message"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            background: '#202020',
            color: '#ffffff',
            borderRadius: 8,
            boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
            fontSize: 13,
          }}
        >
          <span>{message}</span>
          {onDismiss ? (
            <button
              type="button"
              aria-label="Dismiss"
              data-testid="toast-dismiss"
              onClick={() => onDismiss(message)}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#cfcfcf',
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: 1,
                padding: 0,
              }}
            >
              {'×'}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
