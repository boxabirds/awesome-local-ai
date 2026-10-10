import { useSyncExternalStore, type JSX } from 'react';

export interface ToastMessage {
  readonly id: number;
  readonly text: string;
}

// Bottom-centre status line for rejected files and offline adds.
// role=status announces new messages politely (PRD accessibility).
const TOAST_DURATION_MS = 5000;

let nextId = 1;
let messages: ToastMessage[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of Array.from(listeners)) cb();
}

export function showToast(text: string): void {
  const toast: ToastMessage = { id: nextId++, text };
  messages = [...messages, toast];
  notify();
  setTimeout(() => dismissToast(toast.id), TOAST_DURATION_MS);
}

export function dismissToast(id: number): void {
  const next = messages.filter((m) => m.id !== id);
  if (next.length === messages.length) return;
  messages = next;
  notify();
}

// Test seam: component tests assert toasts in isolation.
export function clearToasts(): void {
  if (messages.length === 0) return;
  messages = [];
  notify();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const getSnapshot = (): readonly ToastMessage[] => messages;

export function useToasts(): readonly ToastMessage[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function ToastHost(): JSX.Element {
  const toasts = useToasts();
  return (
    <div className="toast-host" role="status" aria-live="polite" data-testid="toast-host">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" data-testid="toast">
          {toast.text}
        </div>
      ))}
    </div>
  );
}
