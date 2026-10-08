/** Bottom toast with role=status for story 12 — image validation and upload messages */

import React, { useEffect, useState, useRef } from 'react';

interface ToastItem {
  id: number;
  message: string;
}

let nextId = 0;
const toasts: ToastItem[] = [];
const listeners = new Set<() => void>();

/** Add a toast message that auto-dismisses after 4 seconds. */
export function showToast(message: string): void {
  const item: ToastItem = { id: ++nextId, message };
  toasts.push(item);
  for (const cb of listeners) cb();

  setTimeout(() => {
    const idx = toasts.indexOf(item);
    if (idx !== -1) {
      toasts.splice(idx, 1);
      for (const cb of listeners) cb();
    }
  }, 4000);
}

interface ToastProps {
  visible?: boolean;
}

export function Toast({ visible = true }: ToastProps) {
  const [items, setItems] = useState(toasts.slice());

  useEffect(() => {
    const onChange = () => setItems(toasts.slice());
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  if (!visible || items.length === 0) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 70,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: 8,
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      {items.map((item) => (
        <div
          key={item.id}
          role="status"
          style={{
            background: '#323232',
            color: '#fff',
            padding: '8px 16px',
            borderRadius: 8,
            fontSize: 14,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            maxWidth: 400,
            textAlign: 'center',
          }}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
