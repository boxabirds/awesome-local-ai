import { useEffect, useState } from 'react';

const TOAST_MS = 5000;

type Listener = (messages: readonly { id: number; text: string }[]) => void;
let messages: { id: number; text: string }[] = [];
let nextId = 1;
const listeners = new Set<Listener>();
const publish = () => listeners.forEach((l) => l(messages));

/** Short message at the bottom of the screen; the same text shown twice at once collapses into one. */
export function showToast(text: string): void {
  if (messages.some((m) => m.text === text)) return;
  const id = nextId++;
  messages = [...messages, { id, text }];
  publish();
  setTimeout(() => {
    messages = messages.filter((m) => m.id !== id);
    publish();
  }, TOAST_MS);
}

/** Test helper: drops every message at once. */
export function clearToasts(): void {
  messages = [];
  publish();
}

/** Mount once; announces politely through role=status. */
export function ToastHost() {
  const [items, setItems] = useState<readonly { id: number; text: string }[]>(messages);
  useEffect(() => {
    listeners.add(setItems);
    setItems(messages);
    return () => {
      listeners.delete(setItems);
    };
  }, []);
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ position: 'fixed', left: 0, right: 0, bottom: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, zIndex: 40, pointerEvents: 'none' }}
    >
      {items.map((m) => (
        <div key={m.id} style={{ background: '#263238', color: '#fff', padding: '10px 16px', borderRadius: 8, font: '14px system-ui, sans-serif', boxShadow: '0 2px 10px rgba(0,0,0,0.3)' }}>
          {m.text}
        </div>
      ))}
    </div>
  );
}
