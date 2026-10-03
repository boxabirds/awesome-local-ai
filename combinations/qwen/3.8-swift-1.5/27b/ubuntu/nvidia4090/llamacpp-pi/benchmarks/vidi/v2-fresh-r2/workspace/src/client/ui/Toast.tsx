/**
 * Bottom toast stack (story 12, image.insert).
 *
 * A presentational, screen-reader-announced (role=status, aria-live=polite)
 * stack of transient messages, fixed to the bottom of the board. Each toast
 * auto-dismisses (handled by the provider that owns the list).
 */

import type { JSX } from 'react';

export interface ToastItem {
  id: number;
  message: string;
}

/**
 * Render the current toasts at the bottom centre of the board.
 */
export function Toast({ items }: { items: readonly ToastItem[] }): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="toast-stack"
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        zIndex: 2000,
        pointerEvents: 'none',
      }}
    >
      {items.map((t) => (
        <div
          key={t.id}
          data-testid="toast-item"
          style={{
            backgroundColor: '#222',
            color: 'white',
            padding: '10px 16px',
            borderRadius: 8,
            boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
            fontSize: 14,
            maxWidth: 420,
            textAlign: 'center',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
