import { act, cleanup, render, type RenderResult } from '@testing-library/react';
import type * as Y from 'yjs';
import { Board } from '../../src/client/Board';

// jsdom has no ResizeObserver; Board uses it to measure the viewport.
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

export interface BoardHarness extends RenderResult {
  /** The board's live Y.Doc (seed objects through it). */
  doc: Y.Doc;
  /** Set the camera deterministically (wrapped in act). */
  setCamera(x: number, y: number, zoom: number): void;
  /** Run a doc mutation inside act() so React re-renders. */
  seed(fn: (doc: Y.Doc) => void): void;
}

/**
 * Mount the real <Board> with a quiet mocked provider (see the vi.mock in the
 * test file) and expose the doc + camera for deterministic seeding/queries.
 */
export function renderBoard(): BoardHarness {
  const result = render(<Board boardId="test-board" />);
  const win = window as unknown as {
    __vidi6?: { setCamera(x: number, y: number, zoom: number): void; doc?: Y.Doc };
  };
  if (!win.__vidi6 || !win.__vidi6.doc) {
    throw new Error('Board did not expose the __vidi6 test hook (is MODE "test"?).');
  }
  const hook = win.__vidi6;
  return {
    ...result,
    doc: hook.doc as Y.Doc,
    setCamera: (x: number, y: number, zoom: number) => act(() => hook.setCamera(x, y, zoom)),
    seed: (fn: (doc: Y.Doc) => void) => act(() => fn(hook.doc as Y.Doc)),
  };
}

export { cleanup };
