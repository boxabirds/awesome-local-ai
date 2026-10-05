import type { JSX } from 'react';

/**
 * Bottom-centre toasts (story 12): short status messages announced politely
 * (role=status). Auto-dismissal is managed by the caller (useImageInsert).
 */
export function Toast({ messages }: { messages: readonly string[] }): JSX.Element | null {
  if (messages.length === 0) return null;
  return (
    <div
      data-testid="toast-container"
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        zIndex: 100,
        pointerEvents: 'none',
      }}
    >
      {messages.map((message, i) => (
        <div
          key={i}
          role="status"
          data-testid="toast"
          style={{
            background: 'rgba(33, 33, 33, 0.92)',
            color: 'white',
            padding: '8px 16px',
            borderRadius: 6,
            fontSize: 14,
            fontFamily: 'system-ui, sans-serif',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}
        >
          {message}
        </div>
      ))}
    </div>
  );
}
