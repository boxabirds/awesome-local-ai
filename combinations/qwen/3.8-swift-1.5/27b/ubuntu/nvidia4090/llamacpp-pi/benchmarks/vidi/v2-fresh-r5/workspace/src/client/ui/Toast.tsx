/**
 * Bottom-centre toast for status messages (story 12).
 * role="status" for accessibility; auto-dismisses.
 */
import { useState, useCallback, useRef, useEffect, type JSX } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
}

interface ToastProps {
  messages: readonly ToastMessage[];
}

const TOAST_DURATION_MS = 4000;

/**
 * Renders toast messages at the bottom of the screen.
 * Each toast auto-dismisses after TOAST_DURATION_MS.
 */
export function Toast({ messages }: ToastProps): JSX.Element | null {
  if (messages.length === 0) return null;

  return (
    <div
      data-testid="toast-container"
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        zIndex: 10000,
        pointerEvents: 'none',
      }}
    >
      {messages.map((msg) => (
        <div
          key={msg.id}
          role="status"
          aria-live="polite"
          data-testid="toast"
          style={{
            padding: '10px 20px',
            background: '#323232',
            color: 'white',
            borderRadius: '6px',
            fontSize: '14px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            pointerEvents: 'auto',
          }}
        >
          {msg.text}
        </div>
      ))}
    </div>
  );
}

let nextToastId = 1;

/**
 * Hook that manages a queue of toast messages with auto-dismiss.
 * Returns the current messages and a `showToast` function.
 */
export function useToast(): { messages: readonly ToastMessage[]; showToast: (text: string) => void } {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const showToast = useCallback((text: string) => {
    const id = nextToastId++;
    setMessages((prev) => [...prev, { id, text }]);
    const timer = setTimeout(() => dismiss(id), TOAST_DURATION_MS);
    timersRef.current.set(id, timer);
  }, [dismiss]);

  // Cleanup on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  return { messages, showToast };
}
