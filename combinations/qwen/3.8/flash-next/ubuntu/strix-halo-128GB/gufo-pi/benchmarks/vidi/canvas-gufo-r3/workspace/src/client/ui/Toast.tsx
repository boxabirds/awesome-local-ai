import React, { useEffect, useState, useCallback, useRef } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
}

let nextId = 1;
const listeners = new Set<(msg: ToastMessage) => void>();

export function showToast(text: string): void {
  const msg: ToastMessage = { id: nextId++, text };
  for (const cb of listeners) cb(msg);
}

/**
 * Toast container: shows messages at the bottom center, auto-dismisses after 4s.
 * Uses role="status" and aria-live="polite" for accessibility.
 */
export function ToastContainer(): React.JSX.Element | null {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const handler = (msg: ToastMessage) => {
      setMessages((prev) => [...prev, msg]);
      const timer = setTimeout(() => {
        setMessages((prev) => prev.filter((m) => m.id !== msg.id));
        timersRef.current.delete(msg.id);
      }, 4000);
      timersRef.current.set(msg.id, timer);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
      for (const t of timersRef.current.values()) clearTimeout(t);
    };
  }, []);

  if (messages.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="toast-container"
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        zIndex: 10000,
        pointerEvents: 'none',
      }}
    >
      {messages.map((msg) => (
        <div
          key={msg.id}
          data-testid="toast"
          style={{
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            padding: '10px 20px',
            borderRadius: '6px',
            fontSize: '14px',
            maxWidth: '400px',
            textAlign: 'center',
          }}
        >
          {msg.text}
        </div>
      ))}
    </div>
  );
}
