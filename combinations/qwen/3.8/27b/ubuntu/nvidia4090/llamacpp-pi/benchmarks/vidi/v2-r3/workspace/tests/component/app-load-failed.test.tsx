/**
 * TC-23: App in load_failed must not mutate the board model through any
 * editing path (double-click create, Sticky note button, Delete key, drag,
 * text editing, colour, delete button). The connectBoard module is mocked
 * so its fake provider closes the socket with 4500 — the real close-code
 * mapping is covered in load-failed-status.test.tsx (TC-28).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
// Story 5: the board UI moved from App to Board (App now renders the
// pages router), so the load-failed behaviour is exercised on Board
// directly — same component tree, same assertions.
import { Board } from '../../src/client/Board';

// jsdom has no ResizeObserver or pointer capture.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (typeof Element.prototype.setPointerCapture !== 'function') {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  }
});

vi.mock('../../src/client/sync/connectBoard', async () => {
  const bm = await vi.importActual<typeof import('../../src/shared/board-model')>(
    '../../src/shared/board-model',
  );
  return {
    connectBoard: (doc: Y.Doc, _boardId: string, onState: (s: string) => void) => {
      onState('connecting');
      // One existing note on the board (seeded before the lock kicks in).
      queueMicrotask(() => {
        bm.createSticky(doc, { x: 400, y: 300 }, 'yellow');
        onState('load_failed');
      });
      return { destroy() {} };
    },
  };
});

// Dynamic import after the mock registration: spies on this namespace catch
// every mutation call App / StickyNote make (same module instance).
const bm = await import('../../src/shared/board-model');

const MUTATION_METHODS = ['createSticky', 'deleteObject', 'moveObject', 'bringToFront', 'setStickyColor'] as const;

function noteElement() {
  return screen.getByRole('group', { name: 'Sticky note' });
}

describe('TC-23: App in load_failed is not editable (zero model mutations)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('blocks create, delete, drag, edit, colour — no board-model mutation calls', async () => {
    const spies = MUTATION_METHODS.map((name) => vi.spyOn(bm, name) as unknown as ReturnType<typeof vi.fn>);

    const { unmount } = render(<Board boardId="test-load-failed" />);
    // Wait for the mocked provider to close with 4500 and the seed note to render.
    await screen.findByText("This board couldn't be loaded. Retrying…", undefined, { timeout: 5000 });
    await screen.findByRole('group', { name: 'Sticky note' });

    // The seed call above went through the spied namespace, so the spies are
    // live. Clear it before the negative phase.
    expect(spies[0]).toHaveBeenCalledTimes(1); // sanity: createSticky seeded the note
    for (const s of spies) s.mockClear();
    const note = noteElement();
    // Geometry + colour are the model-owned parts of the note's style; the
    // selection outline may change (selecting a note is still allowed).
    const geometry = (el: Element) => {
      const s = (el.getAttribute('style') ?? '').split(';').filter((d) =>
        ['left', 'top', 'width', 'height', 'background'].some((k) => d.trim().startsWith(k)),
      );
      return s.join(';');
    };
    const before = geometry(note);

    // 1. Double-click the board: no new note.
    const viewport = document.querySelector('.board-viewport') as HTMLElement;
    fireEvent.doubleClick(viewport, { clientX: 640, clientY: 400 });
    await waitFor(() => expect(screen.getAllByRole('group', { name: 'Sticky note' })).toHaveLength(1));

    // 2. The Sticky note button is disabled and does nothing.
    const stickyButton = screen.getByRole('button', { name: 'Sticky note' });
    expect((stickyButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(stickyButton);
    await waitFor(() => expect(screen.getAllByRole('group', { name: 'Sticky note' })).toHaveLength(1));

    // 3. Select the note, press Delete: it stays.
    fireEvent.pointerDown(note, { clientX: 100, clientY: 100, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(note, { clientX: 100, clientY: 100, pointerId: 1 });
    await screen.findByRole('button', { name: 'Delete note' });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(noteElement()).toBeTruthy();

    // 4. Drag the note past the threshold: position unchanged.
    fireEvent.pointerDown(note, { clientX: 100, clientY: 100, pointerId: 2, buttons: 1 });
    fireEvent.pointerMove(note, { clientX: 160, clientY: 160, pointerId: 2 });
    fireEvent.pointerUp(note, { clientX: 160, clientY: 160, pointerId: 2 });
    expect(geometry(note)).toBe(before);

    // 5. Double-click the note: no text editor appears.
    fireEvent.doubleClick(note, { clientX: 100, clientY: 100 });
    expect(screen.queryByLabelText('Note text')).toBeNull();

    // 6. The note toolbar's colour and delete are no-ops.
    fireEvent.click(screen.getByRole('button', { name: 'Orange colour' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(geometry(noteElement())).toBe(before);

    // Zero board-model mutation calls in the whole negative phase.
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
    }
    unmount();
  });
});
