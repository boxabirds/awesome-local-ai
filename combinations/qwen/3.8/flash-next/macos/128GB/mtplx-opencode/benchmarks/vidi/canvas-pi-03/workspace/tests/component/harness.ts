import { act } from '@testing-library/react';

/** Build a pointer-style event (jsdom has no PointerEvent constructor; React
 * dispatches by event name, so a MouseEvent carrying a pointerId is enough). */
export function pointerEvent(type: string, x: number, y: number, button = 0): MouseEvent {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button,
  });
  (ev as unknown as { pointerId: number }).pointerId = 1;
  return ev;
}

export function fire(el: EventTarget, ev: Event): void {
  act(() => {
    el.dispatchEvent(ev);
  });
}

/** Seed a note through the test-mode App hook and return its id. */
export function seed(x: number, y: number, color?: string): string {
  const w = window as unknown as { __vidi6: { seedSticky(x: number, y: number, c?: string): string } };
  let id = '';
  act(() => {
    id = w.__vidi6.seedSticky(x, y, color);
  });
  return id;
}

export function boardState(): { selectedId: string | null; editingId: string | null } {
  const w = window as unknown as { __vidi6: { getState(): { selectedId: string | null; editingId: string | null } } };
  return w.__vidi6.getState();
}

export function pressKey(key: string, target: EventTarget = window): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}