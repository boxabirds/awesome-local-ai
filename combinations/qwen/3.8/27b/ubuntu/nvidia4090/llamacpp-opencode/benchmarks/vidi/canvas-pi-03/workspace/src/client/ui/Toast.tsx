import type { ReactElement } from 'react';

/**
 * Story 12 — bottom toast for image insertion feedback (image.* toasts).
 *
 * Renders the active messages (exact PRD wording) in a fixed bottom-centre
 * container with `role="status"` so screen readers announce them. Each message
 * is its own line (a mixed drop can produce a type AND a size message at once,
 * e.g. TC-26). Purely presentational: the messages come from useImageInsert.
 */
export function Toast({ messages }: { messages: readonly string[] }): ReactElement | null {
  if (messages.length === 0) return null;
  return (
    <div
      data-testid="toast"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        zIndex: 10003,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      {messages.map((message, i) => (
        <div
          key={`${i}-${message}`}
          data-testid="toast-message"
          style={{
            background: 'rgba(20, 20, 24, 0.92)',
            color: '#fff',
            padding: '8px 14px',
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.3,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.24)',
          }}
        >
          {message}
        </div>
      ))}
    </div>
  );
}
