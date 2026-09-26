import * as Y from 'yjs';
import { render, RenderResult, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';
import { App } from '@/client/App';
import { createSticky, getStickyText, type ObjectSnapshot, type StickySnapshot } from '@/shared/board-model';
import { newBoardId } from '@/shared/board-id';

export interface Vidi6Hooks {
  setCamera(cam: { x: number; y: number; zoom: number }): void;
  getCamera(): { x: number; y: number; zoom: number };
  getNotes(): readonly StickySnapshot[];
  /** Story 9: every object on the board (sticky + text). */
  getObjects(): readonly ObjectSnapshot[];
  getSelection(): string[];
  getDoc(): Y.Doc;
  /** Story 8: local per-user undo stack non-empty. */
  canUndo(): boolean;
  /** Story 8: local redo stack non-empty. */
  canRedo(): boolean;
  /** Story 8: undo one own step; false when the stack is empty. */
  undo(): boolean;
  /** Story 8: redo one own step; false when the stack is empty. */
  redo(): boolean;
  /** Story 8: close the current capture window. */
  undoBoundary(): void;
}

/** The test-only hooks exposed by App in test mode. */
export function hooks(): Vidi6Hooks {
  const h = (window as unknown as { __vidi6?: Vidi6Hooks }).__vidi6;
  if (!h) throw new Error('__vidi6 test hooks not registered (render the full App first)');
  return h;
}

/**
 * Renders the real <App /> (full story 2 wiring). Story 3 routes the board by
 * URL, so point the (jsdom) location at a fresh /b/<id> first; the sync
 * provider's WebSocket is stubbed in setup.ts so no network is attempted.
 *
 * Story 5: BoardPage runs one async existence check before mounting the
 * board, so this waits for the board viewport (the api module is mocked to
 * answer "exists" in every test file that uses this helper).
 */
export async function renderFullApp(): Promise<RenderResult> {
  window.history.pushState({}, '', '/b/' + newBoardId());
  const view = render(<App />);
  await screen.findByTestId('board-viewport', undefined, { timeout: 5000 });
  return view;
}

/** Creates a note through the board model (as a remote client would). */
export function makeNote(x: number, y: number): string {
  let id = '';
  act(() => {
    id = createSticky(hooks().getDoc(), { x, y });
  });
  return id;
}

/**
 * Selects a note by id with a click at its screen centre. Assumes the initial
 * (reset) camera: jsdom window 1024x768, camera (-512,-384), zoom 1.
 */
export function selectNoteAt(id: string): void {
  const note = hooks().getNotes().find((n) => n.id === id);
  if (!note) throw new Error(`note ${id} not found`);
  const el = document.querySelector(`[data-id="${id}"]`);
  if (!el) throw new Error(`note element ${id} not found`);
  firePointer(el, 'pointerdown', note.x + 100 + 512, note.y + 100 + 384);
  firePointer(el, 'pointerup', note.x + 100 + 512, note.y + 100 + 384);
}

/** Sets a note's text directly in the doc (as a remote client would). */
export function setText(id: string, text: string): void {
  act(() => {
    const t = getStickyText(hooks().getDoc(), id);
    if (!t) throw new Error(`no text for ${id}`);
    t.delete(0, t.length);
    t.insert(0, text);
  });
}

/** Builds a pointer event with the properties jsdom leaves undefined. */
export function makePointerEvent(
  type: string,
  opts: { x: number; y: number; pointerId?: number; button?: number; shiftKey?: boolean },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clientX', { value: opts.x });
  Object.defineProperty(event, 'clientY', { value: opts.y });
  Object.defineProperty(event, 'pointerId', { value: opts.pointerId ?? 1 });
  Object.defineProperty(event, 'button', { value: opts.button ?? 0 });
  Object.defineProperty(event, 'shiftKey', { value: opts.shiftKey ?? false });
  return event;
}

/** Dispatches a pointer event on an element inside act(). */
export function firePointer(
  el: Element,
  type: string,
  x: number,
  y: number,
  opts?: { pointerId?: number; button?: number; shiftKey?: boolean },
): void {
  act(() => {
    el.dispatchEvent(makePointerEvent(type, { x, y, ...opts }));
  });
}

/** Dispatches a pointer event on the WINDOW inside act() (window-listener gestures). */
export function fireWindowPointer(
  type: string,
  x: number,
  y: number,
  opts?: { pointerId?: number; button?: number; shiftKey?: boolean },
): void {
  act(() => {
    window.dispatchEvent(makePointerEvent(type, { x, y, ...opts }));
  });
}

/** Presses a key on window (bubbles from any target to the App handler). */
export function pressKey(target: EventTarget, key: string, init?: KeyboardEventInit): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
}

/** Sets a textarea's value and fires React's onChange (bypasses the value tracker). */
export function typeText(ta: HTMLTextAreaElement, value: string): void {
  fireEvent.input(ta, { target: { value } });
}
