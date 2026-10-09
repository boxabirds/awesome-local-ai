import { act, fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../../src/client/App';
import { createSticky } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { StickySnapshot } from '../../src/shared/board-model';
import type { BoardTestHooks } from '../../src/client/canvas/testHooks';

export function flush(): void {
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

export function board(): BoardTestHooks {
  const hooks = window.__vidi6?.board;
  if (!hooks) throw new Error('board test hooks not installed');
  return hooks;
}

export function notes(): readonly StickySnapshot[] {
  return board().getNotes();
}

// Creates a note whose stored top-left corner is (x, y); createSticky takes
// the centre, so shift by half the note size.
export function createNote(x = 0, y = 0): string {
  let id: string | false = false;
  act(() => {
    id = createSticky(board().doc, {
      x: x + STICKY_SIZE_WORLD / 2,
      y: y + STICKY_SIZE_WORLD / 2,
    });
  });
  flush();
  if (typeof id !== 'string') throw new Error('createSticky failed');
  return id;
}

export function noteEl(id: string): HTMLElement {
  const el = screen
    .getAllByTestId('sticky-note')
    .find((n) => n.getAttribute('data-note-id') === id);
  if (!el) throw new Error(`note ${id} not rendered`);
  return el as HTMLElement;
}

export function pressAndRelease(el: HTMLElement, x = 50, y = 50): void {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: x, clientY: y });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: x, clientY: y });
}

export function readCamera(): { x: number; y: number; zoom: number } {
  const raw = screen.getByTestId('world-layer').getAttribute('data-camera')!;
  const [x, y, zoom] = raw.split(',').map(Number);
  return { x, y, zoom };
}

export function keyDown(
  target: Element | Window,
  key: string,
): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

export { App };
