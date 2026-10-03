import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type * as Y from 'yjs';
import type { Camera } from '../../src/client/canvas/camera';
import { Board } from '../../src/client/board/Board';
import {
  createSticky,
  getStickyText,
  objectBounds,
  snapshot,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';

// Story 5 moved the board out of the app shell: these tests mount the board itself
// (the stories 1-4 surface), which is what the board page shows once a link has been
// answered. The address bar is the router's business and has its own tests.

/** The link the component tests pretend the address bar holds. */
export const TEST_BOARD_ID = 'componenttestboard0004';

/**
 * Render the board at that link, with the address bar holding the link — which is
 * how the board page mounts it, and what the connection is named after.
 */
export function renderBoard(): ReturnType<typeof render> {
  window.history.replaceState(null, '', `/b/${TEST_BOARD_ID}`);
  return render(<Board boardId={TEST_BOARD_ID} />);
}

/** The live board document, exposed by <Board/> in test mode. */
export function boardDoc(): Y.Doc {
  const d = (window as unknown as { __vidi6Board?: Y.Doc }).__vidi6Board;
  if (!d) throw new Error('board doc test hook missing (renderBoard() first)');
  return d;
}

export function surface(): HTMLElement {
  return screen.getByTestId('board-viewport');
}
export function world(): HTMLElement {
  return screen.getByTestId('world-layer');
}
export function noteCount(): number {
  return screen.queryAllByRole('group', { name: 'Sticky note' }).length;
}
export function noteEl(id: string): HTMLElement {
  return screen.getByTestId(`sticky-note-${id}`);
}
export function textEl(id: string): HTMLElement {
  return within(noteEl(id)).getByTestId('sticky-note-text');
}

export function readCamera(): Camera {
  const d = world().dataset;
  return { x: Number(d.x), y: Number(d.y), zoom: Number(d.zoom) };
}

/** Create a note straight through the model so the snapshot renders it. */
export function createNote(x: number, y: number): string {
  let id = '';
  act(() => {
    id = createSticky(boardDoc(), { x, y });
  });
  return id;
}

/** Seed a note's text through the model. */
export function seedText(id: string, text: string): void {
  act(() => {
    getStickyText(boardDoc(), id)?.insert(0, text);
  });
}

export function pointer(
  el: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
): void {
  fireEvent(
    el,
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    }),
  );
}

export function doubleClick(el: Element, x = 0, y = 0): void {
  fireEvent(
    el,
    new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    }),
  );
}

/** Press a note and release without moving: selects it. */
export function clickNote(id: string): void {
  const el = noteEl(id);
  pointer(el, 'pointerdown', 0, 0);
  pointer(el, 'pointerup', 0, 0);
}

/** Shift-press a note and release: adds or removes it from the selection. */
export function shiftClickNote(id: string): void {
  const el = noteEl(id);
  shiftPointer(el, 'pointerdown', 0, 0);
  pointer(el, 'pointerup', 0, 0);
}

export function windowKey(
  key: string,
  modifiers: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {},
): void {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ctrlKey: modifiers.ctrlKey ?? false,
        metaKey: modifiers.metaKey ?? false,
        shiftKey: modifiers.shiftKey ?? false,
      }),
    );
  });
}

/** Dispatch a keydown on a specific element (bubbles to window). */
export function keyOn(el: Element, key: string): void {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
}

/** Set a textarea's value and fire `input` (our editor listens to onInput). */
export function inputInto(el: HTMLElement, value: string): void {
  const ta = el as HTMLTextAreaElement;
  fireEvent.input(ta, { target: { value } });
}

/** Click a swatch / toolbar button by accessible name. */
export function clickByRole(name: string): void {
  const btn = screen.getByRole('button', { name });
  fireEvent(
    btn,
    new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
  );
  fireEvent.click(btn);
}

export function noteSelected(id: string): boolean {
  return noteEl(id).getAttribute('data-selected') === 'true';
}

// --- story 7 helpers -------------------------------------------------------

/**
 * Fire a pointer event carrying `shiftKey`. The marquee and shift-click select
 * gestures branch on this flag, which the plain `pointer` helper never sets.
 */
export function shiftPointer(
  el: Element | Window,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
): void {
  fireEvent(
    el as Element,
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      shiftKey: true,
    }),
  );
}

/**
 * Shift-drag a marquee from one screen point to another: a Shift pointer-down on
 * the board surface, a move and a release on the window (where the marquee hook
 * listens). Releases unless `end` is given as 'cancel'.
 */
export function marqueeDrag(
  from: [number, number],
  to: [number, number],
  end: 'up' | 'cancel' | 'none' = 'up',
): void {
  shiftPointer(surface(), 'pointerdown', from[0], from[1]);
  shiftPointer(window, 'pointermove', to[0], to[1]);
  if (end === 'up') shiftPointer(window, 'pointerup', to[0], to[1]);
  else if (end === 'cancel') shiftPointer(window, 'pointercancel', to[0], to[1]);
}

/** The current world bounds of a note, read straight from the live document. */
export function noteBounds(id: string): Rect {
  const obj = snapshot(boardDoc()).find((n) => n.id === id);
  if (!obj) throw new Error(`note ${id} not in document`);
  return objectBounds(obj);
}

/** The live document snapshot (for "did anything get written?" checks). */
export function modelSnapshot(): readonly StickySnapshot[] {
  return snapshot(boardDoc());
}

/** Any object snapshot (unknown types included) for generic-machinery tests. */
export function rawObjects(): readonly ObjectSnapshot[] {
  return snapshot(boardDoc()) as readonly ObjectSnapshot[];
}

/** The selection bar element, or null when it is not shown. */
export function selectionBarEl(): HTMLElement | null {
  return screen.queryByTestId('selection-bar');
}

/** The count text the bar announces, e.g. "3 selected". */
export function selectionCountText(): string | null {
  const bar = selectionBarEl();
  if (!bar) return null;
  return within(bar).getByText(/^\d+ selected$/).textContent;
}

/** Ids currently marked selected in the DOM, sorted for stable comparison. */
export function selectedIds(): string[] {
  return screen
    .getAllByTestId(/^sticky-note-./)
    .filter((el) => el.getAttribute('data-selected') === 'true')
    .map((el) => el.getAttribute('data-note-id')!)
    .sort();
}
