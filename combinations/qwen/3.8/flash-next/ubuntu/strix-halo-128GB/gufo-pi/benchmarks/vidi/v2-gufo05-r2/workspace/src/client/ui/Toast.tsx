/**
 * Story 12: bottom-centre toast for status messages.
 *
 * Uses `role=status` for polite screen-reader announcements.
 */

import { useCallback, useRef, useState } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
}

export interface ToastState {
  messages: readonly ToastMessage[];
  show(text: string): void;
}

let nextId = 1;
const TOAST_DURATION_MS = 5000;

export function useToast(): ToastState {
  const [messages, setMessages] = useState<readonly ToastMessage[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (text: string) => {
      const id = nextId++;
      setMessages((prev) => [...prev, { id, text }]);
      const timer = setTimeout(() => dismiss(id), TOAST_DURATION_MS);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  return { messages, show };
}

export function Toast({ messages }: { messages: readonly ToastMessage[] }) {
  if (messages.length === 0) return null;
  return (
    <div className="toast-container" role="status" aria-live="polite">
      {messages.map((msg) => (
        <div key={msg.id} className="toast" data-testid="toast">
          {msg.text}
        </div>
      ))}
    </div>
  );
}
