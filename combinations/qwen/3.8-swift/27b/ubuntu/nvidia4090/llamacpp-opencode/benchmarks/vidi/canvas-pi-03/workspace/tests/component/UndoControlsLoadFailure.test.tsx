/**
 * Story 8 component test — undo.controls (TC-20): a load-failed board is
 * read-only — undo/redo shortcuts are ignored and both buttons are disabled.
 *
 * The (mocked) provider reports a 4500 close for this file so `canEdit` is
 * false, while the board doc itself is real and seeded directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';

vi.mock('src/client/sync/connectBoard', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('src/client/sync/connectBoard')>();
  return {
    ...actual,
    connectBoard: vi.fn((_doc, _boardId, onState) => {
      onState('load_failed');
      return {
        destroy: () => {},
        dropSocket: () => {},
        resumeSocket: () => {},
      };
    }),
  };
});

import { App } from 'src/client/App';
import { boardReady } from './ready';
import { createSticky, snapshot } from 'src/shared/board-model';

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

describe('undo.controls load-failed (component)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('TC-20: load-failed board → shortcuts ignored, buttons disabled (negative)', async () => {
    const doc = getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 }, 'yellow', 'a')!;
    });
    const [note] = screen.getAllByTestId('sticky-note');

    const user = userEvent.setup();
    await user.click(note);
    // The board is read-only: nudging does nothing…
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    let s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(-100);
    // …and undo/redo shortcuts are ignored even though a create step exists.
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(-100);
    expect(snapshot(doc).some((n) => n.id === id)).toBe(true);

    const undoBtn = screen.getByTestId('undo-button') as HTMLButtonElement;
    const redoBtn = screen.getByTestId('redo-button') as HTMLButtonElement;
    expect(undoBtn).toBeDisabled();
    expect(undoBtn).toHaveAttribute('aria-disabled', 'true');
    expect(redoBtn).toBeDisabled();
    expect(redoBtn).toHaveAttribute('aria-disabled', 'true');
  });
});
