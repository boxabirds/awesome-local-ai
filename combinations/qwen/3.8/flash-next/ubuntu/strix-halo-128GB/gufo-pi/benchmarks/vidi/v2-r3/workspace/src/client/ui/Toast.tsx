/**
 * Toast notification component (story 12).
 * Shows messages at bottom-centre of screen with auto-dismiss.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
}

export interface ToastHandle {
  show(text: string): void;
}

let nextId = 1;

export interface ToastContainerProps {
  messages: readonly ToastMessage[];
}

export function ToastContainer({ messages }: ToastContainerProps) {
  if (messages.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="toast-container"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 1000,
        pointerEvents: 'none',
      }}
    >
      {messages.map((msg) => (
        <div
          key={msg.id}
          data-testid="toast-message"
          style={{
            backgroundColor: '#323232',
            color: '#fff',
            padding: '12px 24px',
            borderRadius: 8,
            fontSize: 14,
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            whiteSpace: 'nowrap',
          }}
        >
          {msg.text}
        </div>
      ))}
    </div>
  );
}

const TOAST_DURATION_MS = 5000;

export function useToast(): { messages: readonly ToastMessage[]; show(text: string): void } {
  const [messages, setMessages] = useState<readonly ToastMessage[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const show = useCallback((text: string) => {
    const id = nextId++;
    setMessages((prev) => [...prev, { id, text }]);
    const timer = setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
      timersRef.current.delete(id);
    }, TOAST_DURATION_MS);
    timersRef.current.set(id, timer);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  return { messages, show };
}
