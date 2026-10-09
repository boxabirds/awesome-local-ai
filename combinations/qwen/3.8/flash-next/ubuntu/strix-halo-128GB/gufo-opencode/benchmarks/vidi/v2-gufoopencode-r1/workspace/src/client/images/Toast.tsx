import type { JSX } from 'react';

// Story 12: short bottom-centre message for refused files (image.types,
// image.size_limit, image.count_limit, image.offline). role=status so screen
// readers announce it; each toast auto-dismisses via its own timer in
// useImageInsert.
export interface ToastMessage {
  id: number;
  message: string;
}

export function Toast({ toasts }: { toasts: readonly ToastMessage[] }): JSX.Element | null {
  if (toasts.length === 0) return null;
  return (
    <div
      data-testid="image-toast-stack"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        zIndex: 60,
        pointerEvents: 'none'
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          data-testid="image-toast"
          style={{
            background: '#1f2430',
            color: '#ffffff',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 14,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
            maxWidth: '90vw'
          }}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
