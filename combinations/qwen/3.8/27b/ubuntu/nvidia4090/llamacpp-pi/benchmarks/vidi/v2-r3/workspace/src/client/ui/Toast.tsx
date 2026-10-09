/**
 * Story 12 (image.insert): the short bottom toast for refused files / the
 * offline gate. role=status + aria-live=polite so screen readers announce
 * the messages politely (PRD a11y constraint).
 */
import type { ReactElement } from 'react';

export interface ToastMessage {
  readonly id: number;
  readonly message: string;
}

export function Toast({ toasts }: { toasts: readonly ToastMessage[] }): ReactElement | null {
  if (toasts.length === 0) return null;
  return (
    <div
      className="toast-stack"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        zIndex: 40,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast"
          style={{
            background: '#23272e',
            color: '#fff',
            padding: '8px 14px',
            borderRadius: 8,
            fontSize: 13,
            maxWidth: 480,
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
