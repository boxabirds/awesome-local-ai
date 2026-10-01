import { type JSX } from 'react';

export interface ToastProps {
  message: string;
}

/**
 * Bottom-centre status toast (story 12). `role="status"` so screen readers
 * announce it; auto-dismiss is handled by the owner (useImageInsert).
 */
export function Toast({ message }: ToastProps): JSX.Element {
  return (
    <div
      data-testid="toast"
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        backgroundColor: '#263238',
        color: '#fff',
        padding: '10px 18px',
        borderRadius: 8,
        fontSize: 14,
        zIndex: 2000,
        boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
        maxWidth: '80vw',
        textAlign: 'center',
      }}
    >
      {message}
    </div>
  );
}
