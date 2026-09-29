/**
 * Story 7 component test — sel.transform TC-25: on a `load_failed` board
 * (canEdit false) the transform gesture is a no-op: pressing and dragging a
 * note writes nothing to the doc (negative / lock path).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';

// Force the board into `load_failed` for this file (canEdit → false).
vi.mock('src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('src/client/sync/connectBoard')>();
  return {
    ...actual,
    connectBoard: vi.fn((_doc, _boardId, onState) => {
      onState('load_failed');
      return { destroy: () => {}, dropSocket: () => {}, resumeSocket: () => {} };
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

async function flushRaf() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('sel.transform on a locked board (component)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('TC-25: canEdit false → drag writes nothing (negative)', async () => {
    const doc = getDoc();
    act(() => {
      createSticky(doc, { x: 0, y: 0 }, 'yellow', 'a'); // screen [512,384]–[712,584]
    });
    const [note] = screen.getAllByTestId('sticky-note');

    const user = userEvent.setup();
    // Selection is still allowed on a locked board…
    await user.click(note);
    expect(note.hasAttribute('data-selected')).toBe(true);

    // …but dragging must not move the note.
    fireEvent.pointerDown(note, { pointerId: 1, button: 0, clientX: 612, clientY: 484 });
    fireEvent.pointerMove(note, { pointerId: 1, clientX: 662, clientY: 484 });
    await flushRaf();
    fireEvent.pointerUp(note, { pointerId: 1, clientX: 662, clientY: 484 });
    await flushRaf();

    // The note is centred on at=(0,0) → world (-100,-100); it must be unchanged.
    const s = snapshot(doc);
    expect(s).toHaveLength(1);
    expect(s[0].x).toBe(-100);
    expect(s[0].y).toBe(-100);
  });
});
