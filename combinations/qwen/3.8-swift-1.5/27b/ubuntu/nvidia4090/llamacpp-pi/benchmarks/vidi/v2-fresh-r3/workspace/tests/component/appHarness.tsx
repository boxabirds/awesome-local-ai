import { vi, beforeEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { Board } from '../../src/client/pages/BoardPage';
import { createSticky, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import type { Vidi6TestHooks } from '../../src/client/canvas/testHooks';

/**
 * A valid, fixed board id for the harness (22 lowercase base32 chars).
 */
const HARNESS_BOARD_ID = 'a'.repeat(22);

// Mock the network + API layers so the board renders in jsdom without a server.
// `checkBoard` resolves to "exists" so BoardPage mounts the board; `connectBoard`
// is a no-op so no WebSocket is opened.
vi.mock('../../src/client/api', () => ({
  checkBoard: vi.fn(async () => ({ kind: 'exists' })),
  createBoardRequest: vi.fn(async () => ({ kind: 'created', id: 'a'.repeat(22) })),
}));

vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: vi.fn(() => ({ destroy: () => {} })),
}));

class MockResizeObserver {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(_el: Element) {
    const entry = { contentRect: { width: 1280, height: 800 } } as any;
    this.callback([entry], this as any);
  }
  disconnect() {}
  unobserve() {}
}

vi.stubGlobal('ResizeObserver', MockResizeObserver);

// Pointer capture is not available in jsdom
beforeEach(() => {
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = function (_id: number) {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = function (_id: number) {};
  }
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'releasePointerCapture').mockImplementation(() => {});
  cleanup();
  // Clear the previous test's hook so `renderApp` waits for the fresh board.
  delete (window as unknown as { __vidi6?: unknown }).__vidi6;
});

export interface AppHarness extends RenderResult {
  doc: Y.Doc;
  /** Creates a sticky note centred on the given world point (inside act). */
  addNote(at: { x: number; y: number }): string;

  notes(): readonly StickySnapshot[];
  note(id: string): HTMLElement;
  noteOrNull(id: string): HTMLElement | null;
}

/**
 * Renders the app at a board route (`/b/<id>`) and waits for the board to be
 * ready (the existence check resolves and the board mounts). Returns the Y.Doc
 * plus note helpers.
 */
export async function renderApp(opts: { canEdit?: boolean } = {}): Promise<AppHarness> {
  // Put the app on a board route so <App /> renders the board (not the home page).
  window.history.pushState({}, '', `/b/${HARNESS_BOARD_ID}`);

  // canEdit=false renders the Board directly with the guard forced off
  // (the load-failed state; the app never mounts the board in that case).
  const result = opts.canEdit === false ? render(<Board boardId={HARNESS_BOARD_ID} canEdit={false} />) : render(<App />);

  // The board mounts after the (mocked, resolved) existence check.
  await waitFor(() => {
    const hooks = (window as unknown as { __vidi6?: Vidi6TestHooks }).__vidi6;
    if (!hooks) throw new Error('board not ready');
  });

  const doc = (window as unknown as { __vidi6: Vidi6TestHooks }).__vidi6.getDoc();

  function addNote(at: { x: number; y: number }): string {
    let id = '';
    act(() => {
      id = createSticky(doc, at);
    });
    return id;
  }

  function notes(): readonly StickySnapshot[] {
    return snapshot(doc);
  }

  function note(id: string): HTMLElement {
    const el = document.querySelector(`[data-note-id="${id}"]`);
    if (!el) throw new Error(`note ${id} not found`);
    return el as HTMLElement;
  }

  function noteOrNull(id: string): HTMLElement | null {
    return (document.querySelector(`[data-note-id="${id}"]`) as HTMLElement | null) ?? null;
  }

  return { ...result, doc, addNote, notes, note, noteOrNull };
}

export interface PointerEventOptions {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** Dispatches a pointer event with clientX/clientY (and modifiers) on the given element (or window). */
export function pointerEvent(
  el: Element | Window,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  pointerId = 1,
  opts: PointerEventOptions = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    shiftKey: opts.shiftKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
  });
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: y });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  el.dispatchEvent(event);
}

/** Dispatches a dblclick on the given element. */
export function doubleClick(el: Element, x = 0, y = 0) {
  const event = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: y });
  el.dispatchEvent(event);
}

/** The board viewport element (empty-space target for pan/marquee/clear). */
export function getViewport(): HTMLElement {
  const el = document.querySelector('[data-testid="board-viewport"]');
  if (!el) throw new Error('board viewport not found');
  return el as HTMLElement;
}

/** Sets a note's explicit width/height in world units (component-test fixture). */
export function setSize(doc: Y.Doc, id: string, width: number, height: number) {
  const obj = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  if (!obj) throw new Error(`setSize: unknown note ${id}`);
  obj.set('width', width);
  obj.set('height', height);
}

/** Plain pointerdown on a note (selects it; may start a gesture). */
export function pressNote(app: AppHarness, id: string, x = 0, y = 0) {
  act(() => {
    pointerEvent(app.note(id), 'pointerdown', x, y);
  });
}

/** Shift+pointerdown on a note (adds/removes it from the selection). */
export function shiftPressNote(app: AppHarness, id: string, x = 0, y = 0) {
  act(() => {
    pointerEvent(app.note(id), 'pointerdown', x, y, 1, { shiftKey: true });
  });
}

/**
 * Drags a note by (dx, dy) client pixels (identity camera → world pixels).
 * Returns after pointerup, so the final position is the exact target.
 */
export function dragNote(app: AppHarness, id: string, dx: number, dy: number, from = { x: 100, y: 100 }) {
  pressNote(app, id, from.x, from.y);
  act(() => {
    pointerEvent(window, 'pointermove', from.x + dx, from.y + dy);
  });
  act(() => {
    pointerEvent(window, 'pointerup', from.x + dx, from.y + dy);
  });
}

/** The resize handle element of the current selection overlay. */
export function getHandle(handle: string): HTMLElement {
  const el = document.querySelector(`[data-testid="resize-handle-${handle}"]`);
  if (!el) throw new Error(`resize handle ${handle} not found`);
  return el as HTMLElement;
}

/** Drags a resize handle of the current selection by (dx, dy) client pixels. */
export function dragHandle(handle: string, dx: number, dy: number, from = { x: 300, y: 300 }, opts: PointerEventOptions = {}) {
  act(() => {
    pointerEvent(getHandle(handle), 'pointerdown', from.x, from.y, 1, opts);
  });
  act(() => {
    pointerEvent(window, 'pointermove', from.x + dx, from.y + dy, 1, opts);
  });
  act(() => {
    pointerEvent(window, 'pointerup', from.x + dx, from.y + dy, 1, opts);
  });
}

/** Shift+drag marquee from (x1,y1) to (x2,y2) over the empty viewport. */
export function marqueeDrag(x1: number, y1: number, x2: number, y2: number) {
  const vp = getViewport();
  act(() => {
    pointerEvent(vp, 'pointerdown', x1, y1, 1, { shiftKey: true });
  });
  act(() => {
    pointerEvent(vp, 'pointermove', (x1 + x2) / 2, (y1 + y2) / 2, 1, { shiftKey: true });
  });
  act(() => {
    pointerEvent(vp, 'pointerup', x2, y2, 1, { shiftKey: true });
  });
}

/** Dispatches a window keydown (with modifiers). Returns the event (for defaultPrevented checks). */
export function windowKeyDown(
  key: string,
  opts: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    shiftKey: opts.shiftKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
  });
  window.dispatchEvent(event);
  return event;
}
