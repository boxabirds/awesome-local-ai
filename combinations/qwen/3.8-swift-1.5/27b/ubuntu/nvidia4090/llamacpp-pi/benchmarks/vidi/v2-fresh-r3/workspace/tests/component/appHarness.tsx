import { vi, beforeEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
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
export async function renderApp(): Promise<AppHarness> {
  // Put the app on a board route so <App /> renders the board (not the home page).
  window.history.pushState({}, '', `/b/${HARNESS_BOARD_ID}`);

  const result = render(<App />);

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

/** Dispatches a pointer event with clientX/clientY on the given element. */
export function pointerEvent(
  el: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  pointerId = 1,
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
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

/** Dispatches a window keydown. */
export function windowKeyDown(key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}
