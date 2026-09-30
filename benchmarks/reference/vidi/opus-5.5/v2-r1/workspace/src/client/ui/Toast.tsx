// Short messages at the bottom of the screen (story 12), announced politely.
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a message stays on screen. */
export const TOAST_DURATION_MS = 5000;

export interface ToastMessage {
  id: number;
  text: string;
}

/** Messages currently shown; showing a text that is already shown restarts its time. */
export function useToasts(durationMs = TOAST_DURATION_MS) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);
  const show = useCallback(
    (text: string) => {
      const id = nextId.current++;
      setMessages((prev) => {
        for (const m of prev) {
          if (m.text === text) {
            clearTimeout(timers.current.get(m.id));
            timers.current.delete(m.id);
          }
        }
        return [...prev.filter((m) => m.text !== text), { id, text }];
      });
      timers.current.set(id, setTimeout(() => dismiss(id), durationMs));
    },
    [dismiss, durationMs],
  );
  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all.values()) clearTimeout(t);
      all.clear();
    };
  }, []);
  return { messages, show, dismiss };
}

/** Bottom-centre toasts. The live region is always mounted so every message is announced. */
export function Toast(props: { messages: readonly ToastMessage[] }) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {props.messages.map((m) => (
        <div key={m.id} className="toast">
          {m.text}
        </div>
      ))}
    </div>
  );
}
