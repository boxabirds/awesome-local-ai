import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
}

let nextId = 1;

export interface ToastApi {
  show(text: string): void;
  messages: ReadonlyArray<ToastMessage>;
}

export function useToast(): ToastApi {
  const [messages, setMessages] = useState<ReadonlyArray<ToastMessage>>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const show = useCallback((text: string) => {
    const id = nextId++;
    setMessages((prev) => [...prev, { id, text }]);
    const timer = setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
      timersRef.current.delete(id);
    }, 4000);
    timersRef.current.set(id, timer);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  return { show, messages };
}

export function ToastContainer({ messages }: { messages: ReadonlyArray<ToastMessage> }): ReactElement | null {
  if (messages.length === 0) return null;
  return (
    <div className="toast-container" role="status" aria-live="polite" data-testid="toast-container">
      {messages.map((m) => (
        <div key={m.id} className="toast-message" data-testid="toast-message">
          {m.text}
        </div>
      ))}
    </div>
  );
}
