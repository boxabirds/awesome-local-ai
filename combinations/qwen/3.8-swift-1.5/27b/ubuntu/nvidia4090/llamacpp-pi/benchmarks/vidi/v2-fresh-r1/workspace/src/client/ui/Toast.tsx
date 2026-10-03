// Bottom-centre toast notification with role=status.
// Story 12. Auto-dismisses after a short delay.

import { useCallback, useRef, useState } from 'react';

export interface ToastApi {
  show(message: string): void;
}

export function useToast(durationMs = 4000): { toast: ToastApi; node: React.ReactNode } {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((msg: string) => {
    setMessage(msg);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMessage(null), durationMs);
  }, [durationMs]);

  const node = message ? (
    <div
      role="status"
      data-testid="toast"
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: '#323232',
        color: 'white',
        padding: '10px 20px',
        borderRadius: '8px',
        fontSize: '14px',
        zIndex: 10000,
        boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
      }}
    >
      {message}
    </div>
  ) : null;

  return { toast: { show }, node };
}
