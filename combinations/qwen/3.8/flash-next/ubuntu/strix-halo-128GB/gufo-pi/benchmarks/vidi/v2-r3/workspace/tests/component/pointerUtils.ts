import { act, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

/** Dispatch a pointer event of the given type on a target (element or window). */
export function pointer(
  target: Element | Window,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  init: PointerEventInit = {},
): void {
  fireEvent(
    target,
    new PointerEvent(type, {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      ...init,
    }),
  );
}

/**
 * Let `n` animation frames pass so rAF-throttled work is applied. Needs fake
 * timers (`vi.useFakeTimers()`), like the story 1 viewport tests.
 */
export function frames(n = 2): void {
  for (let i = 0; i < n; i += 1) {
    act(() => {
      vi.advanceTimersByTime(16);
    });
  }
}

/** Type into a textarea the way a browser would: set the value, then `input`. */
export function typeInto(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  el.value = value;
  fireEvent.input(el);
}
