/**
 * Bottom-centre toast with role=status for accessibility announcements.
 * Auto-dismisses after a configurable duration.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
}

let nextId = 1;

export function useToast(duration = 4000) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const show = useCallback(
    (text: string) => {
      const id = nextId++;
      setMessages((prev) => [...prev, { id, text }]);
      const timer = setTimeout(() => {
        setMessages((prev) => prev.filter((m) => m.id !== id));
        timers.current.delete(id);
      }, duration);
      timers.current.set(id, timer);
    },
    [duration]
  );

  const dismiss = useCallback((id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  // Cleanup all timers on unmount
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  return { messages, show, dismiss };
}

export function ToastContainer({ messages, onDismiss }: { messages: ToastMessage[]; onDismiss(id: number): void }): JSX.Element | null {
  if (messages.length === 0) return null;
  return (
    <div className="vidi6-toast-container" data-vidi6="toast-container">
      {messages.map((msg) => (
        <div key={msg.id} className="vidi6-toast" data-vidi6="toast" role="status" onClick={() => onDismiss(msg.id)}>
          {msg.text}
        </div>
      ))}
    </div>
  );
}
