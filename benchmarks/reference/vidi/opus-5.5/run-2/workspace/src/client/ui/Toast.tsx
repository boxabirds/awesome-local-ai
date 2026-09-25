/**
 * Short status messages at the bottom centre of the screen (story 12: refused files,
 * offline, rate limit). `role="status"` so screen readers announce them politely. Each
 * `show` replaces what is shown and restarts the TOAST_DURATION_MS timer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { TOAST_DURATION_MS } from '../../shared/config';

export interface ToastApi {
  messages: readonly string[];
  show(messages: readonly string[]): void;
  dismiss(): void;
}

export function useToast(durationMs: number = TOAST_DURATION_MS): ToastApi {
  const [messages, setMessages] = useState<readonly string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismiss = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setMessages([]);
  }, []);
  const show = useCallback(
    (next: readonly string[]) => {
      if (next.length === 0) return;
      if (timer.current !== null) clearTimeout(timer.current);
      setMessages([...new Set(next)]);
      timer.current = setTimeout(() => {
        timer.current = null;
        setMessages([]);
      }, durationMs);
    },
    [durationMs],
  );
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return { messages, show, dismiss };
}

export function Toast(props: { messages: readonly string[] }): React.JSX.Element | null {
  if (props.messages.length === 0) return null;
  return (
    <div className="toast" role="status" data-testid="toast">
      {props.messages.map((m) => (
        <p key={m} className="toast-message">
          {m}
        </p>
      ))}
    </div>
  );
}
