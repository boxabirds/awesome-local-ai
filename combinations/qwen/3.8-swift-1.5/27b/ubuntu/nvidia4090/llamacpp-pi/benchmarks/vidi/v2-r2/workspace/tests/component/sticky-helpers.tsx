import { render, act } from '@testing-library/react';
import App from '../../src/client/App';
import type * as Y from 'yjs';
import type { Camera } from '../../src/client/canvas/camera';
import { snapshot, type StickySnapshot } from '../../src/shared/board-model';

interface RenderedApp {
  getDoc(): Y.Doc;
  setCamera(cam: Camera): void;
  notes(): readonly StickySnapshot[];
}

/**
 * Renders the real App (with the ResizeObserver polyfill from tests/setup.ts)
 * and exposes the Y.Doc + camera for test-driven model calls.
 */
export function renderApp(): RenderedApp {
  render(<App />);
  const vidi6 = () => (window as unknown as { __vidi6: { setCamera(cam: Camera): void; doc: Y.Doc } }).__vidi6;
  return {
    getDoc: () => vidi6().doc,
    setCamera: (cam: Camera) =>
      act(() => {
        vidi6().setCamera(cam);
      }),
    notes: () => snapshot(vidi6().doc),
  };
}

export function getNote(id: string): HTMLElement | null {
  return document.querySelector(`[data-note-id="${id}"]`);
}

/** Flushes pending requestAnimationFrame callbacks (drag position writes). */
export async function flushRaf(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
