import { useSyncExternalStore } from 'react';

const TOAST_DURATION_MS = 5000;

interface ToastItem { id: number; message: string }

let items: readonly ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Shows a short message at the bottom of the screen; identical messages already showing are not repeated. */
export function showToast(message: string, durationMs = TOAST_DURATION_MS): void {
  if (items.some((t) => t.message === message)) return;
  const id = nextId++;
  items = [...items, { id, message }];
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, durationMs);
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export function Toast() {
  const current = useSyncExternalStore(subscribe, () => items);
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {current.map((t) => <div key={t.id} className="toast">{t.message}</div>)}
    </div>
  );
}
