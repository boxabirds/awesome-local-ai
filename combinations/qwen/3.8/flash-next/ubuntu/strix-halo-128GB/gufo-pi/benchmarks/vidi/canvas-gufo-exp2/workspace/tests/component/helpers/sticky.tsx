import { act, fireEvent, screen, within } from '@testing-library/react';
import type { StickySnapshot } from '../../../src/shared/board-model';
import { flushFrame, viewportEl } from './board';

/**
 * Sticky-note helpers for component tests. Notes are read through the
 * test-only `window.__vidi6` bridge (the same one the e2e tests use), so
 * assertions are about the shared board model rather than private React state.
 */

const POINTER_START = { x: 500, y: 400 };

export function api(): NonNullable<Window['__vidi6']> {
  const bridge = window.__vidi6;
  if (!bridge?.getNotes || !bridge.deleteNote) {
    throw new Error('window.__vidi6 board hooks are not installed (MODE must be "test")');
  }
  return bridge;
}

export function notes(): StickySnapshot[] {
  return api().getNotes!();
}

export function noteEls(): HTMLElement[] {
  return screen.queryAllByTestId('sticky-note');
}

/** Find a note element by id, or by render order when no id is given. */
export function noteEl(idOrIndex?: string | number): HTMLElement {
  const els = noteEls();
  if (idOrIndex === undefined) {
    if (!els[0]) throw new Error(`no sticky notes on the board`);
    return els[0];
  }
  if (typeof idOrIndex === 'number') {
    if (!els[idOrIndex]) {
      throw new Error(`no sticky note at index ${idOrIndex} (found ${els.length})`);
    }
    return els[idOrIndex];
  }
  const found = els.find((el) => el.dataset.stickyId === idOrIndex);
  if (!found) throw new Error(`no sticky note with id ${idOrIndex}`);
  return found;
}

export function idOf(el: HTMLElement): string {
  const id = el.dataset.stickyId;
  if (!id) throw new Error('note element has no data-sticky-id');
  return id;
}

export function textareas(): HTMLTextAreaElement[] {
  return screen
    .queryAllByTestId('sticky-textarea')
    .filter((el): el is HTMLTextAreaElement => el instanceof HTMLTextAreaElement);
}

export function textarea(): HTMLTextAreaElement {
  const [first] = textareas();
  if (!first) throw new Error('no sticky text editor is open');
  return first;
}

/** Create a note by double-clicking the empty board at a screen point. */
export function doubleClickBoard(x: number, y: number): void {
  fireEvent.doubleClick(viewportEl(), { clientX: x, clientY: y });
}

export function pressOn(el: HTMLElement, pointerId = 1): void {
  fireEvent.pointerDown(el, {
    clientX: POINTER_START.x,
    clientY: POINTER_START.y,
    pointerId,
    isPrimary: true,
    button: 0,
    buttons: 1,
  });
}

export function moveOn(el: HTMLElement, dx: number, dy: number, pointerId = 1): void {
  fireEvent.pointerMove(el, {
    clientX: POINTER_START.x + dx,
    clientY: POINTER_START.y + dy,
    pointerId,
    isPrimary: true,
    button: 0,
    buttons: 1,
  });
}

export function releaseOn(el: HTMLElement, dx = 0, dy = 0, pointerId = 1): void {
  fireEvent.pointerUp(el, {
    clientX: POINTER_START.x + dx,
    clientY: POINTER_START.y + dy,
    pointerId,
    isPrimary: true,
    button: 0,
  });
}

export function cancelOn(el: HTMLElement, pointerId = 1): void {
  fireEvent.pointerCancel(el, {
    clientX: POINTER_START.x,
    clientY: POINTER_START.y,
    pointerId,
    isPrimary: true,
    button: 0,
  });
}

/** Let a requestAnimationFrame-throttled write land, inside act(). */
export async function settle(): Promise<void> {
  await act(async () => {
    await flushFrame();
  });
}

/** Delete through the board model, as a remote peer would. */
export function deleteNoteViaModel(id: string): boolean {
  let result = false;
  act(() => {
    result = api().deleteNote!(id);
  });
  return result;
}

/**
 * Press, move through every offset in `steps` (screen px, applied cumulatively
 * from the same origin) and release. Pass `cancel: true` to end with
 * pointercancel instead. Returns after one animation frame so any
 * rAF-throttled model write has landed.
 */
export async function dragOn(
  el: HTMLElement,
  steps: { dx: number; dy: number }[],
  options: { cancel?: boolean } = {},
): Promise<void> {
  pressOn(el);
  for (const step of steps) moveOn(el, step.dx, step.dy);
  if (options.cancel) cancelOn(el);
  else releaseOn(el, steps.at(-1)?.dx ?? 0, steps.at(-1)?.dy ?? 0);
  await settle();
}

/** Type into the open editor the way a browser does: set value, fire `input`. */
export function typeText(value: string): void {
  act(() => {
    const el = textarea();
    el.value = value;
    fireEvent.input(el, { target: { value } });
  });
}

export function pressKey(key: string, target?: Element | Window): void {
  const node = target ?? document.activeElement ?? window;
  act(() => {
    fireEvent.keyDown(node, { key });
  });
}

export function swatch(el: HTMLElement, name: string): HTMLElement {
  return within(el).getByRole('button', { name: `${name} colour` });
}

export function deleteButton(el: HTMLElement): HTMLElement {
  return within(el).getByRole('button', { name: 'Delete note' });
}
