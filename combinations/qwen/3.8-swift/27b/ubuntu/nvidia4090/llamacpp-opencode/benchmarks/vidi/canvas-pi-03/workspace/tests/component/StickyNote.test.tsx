import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// jsdom does not synthesise `dblclick` from user-event's click sequences,
// so double-clicks are dispatched directly (real-browser dblclick is covered
// by the e2e tests).
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from 'src/client/App';
import { snapshot, deleteObject } from 'src/shared/board-model';

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

async function flushRaf() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

async function createNoteByDblClick() {
  const viewport = screen.getByTestId('board-viewport');
  fireEvent.doubleClick(viewport, { clientX: 0, clientY: 0 });
  return screen.getAllByTestId('sticky-note');
}

/** pointerdown → (optional move) → pointerup on a note with explicit client coords. */
function pressRelease(
  note: HTMLElement,
  moveBy: { x: number; y: number },
  releaseKind: 'up' | 'cancel' = 'up',
) {
  fireEvent.pointerDown(note, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
  if (moveBy.x !== 0 || moveBy.y !== 0) {
    fireEvent.pointerMove(note, {
      pointerId: 1,
      clientX: 100 + moveBy.x,
      clientY: 100 + moveBy.y,
    });
  }
  if (releaseKind === 'up') {
    fireEvent.pointerUp(note, { pointerId: 1, clientX: 100 + moveBy.x, clientY: 100 + moveBy.y });
  } else {
    fireEvent.pointerCancel(note, { pointerId: 1, clientX: 100 + moveBy.x, clientY: 100 + moveBy.y });
  }
}

describe('sticky.interaction (component)', () => {
  beforeEach(() => {
    render(<App />);
  });

  it('TC-18: press+release without move selects the note (outline + toolbar)', async () => {
    const user = userEvent.setup();
    const [note] = await createNoteByDblClick();
    await user.keyboard('{Escape}'); // end editing → selected
    await user.click(screen.getByTestId('board-viewport')); // deselect

    expect(note.hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    await user.click(note);

    expect(note.hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });

  it('TC-19: moving 2px (< DRAG_THRESHOLD_PX) selects but does not move the note', async () => {
    const user = userEvent.setup();
    const [note] = await createNoteByDblClick();
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('board-viewport')); // deselect first

    const before = snapshot(getDoc())[0];
    pressRelease(note, { x: 2, y: 0 });
    await flushRaf();

    const after = snapshot(getDoc())[0];
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(note.hasAttribute('data-selected')).toBe(true);
  });

  it('TC-20: moving 3px (= threshold) starts a drag and does not pan the board', async () => {
    const user = userEvent.setup();
    const [note] = await createNoteByDblClick();
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('board-viewport')); // deselect first

    const viewport = screen.getByTestId('board-viewport');
    const gridBefore = viewport.style.backgroundPosition;

    const before = snapshot(getDoc())[0];
    pressRelease(note, { x: 3, y: 0 });
    await flushRaf();

    const after = snapshot(getDoc())[0];
    // zoom is 1 in jsdom: 3 screen px = 3 world units
    expect(after.x).toBe(before.x + 3);
    expect(after.y).toBe(before.y);
    // the board camera must not have moved (no pan)
    expect(viewport.style.backgroundPosition).toBe(gridBefore);
  });

  it('TC-21: pointercancel during a drag ends the drag at the last applied position', async () => {
    const user = userEvent.setup();
    const [note] = await createNoteByDblClick();
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('board-viewport')); // deselect first

    const before = snapshot(getDoc())[0];
    fireEvent.pointerDown(note, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(note, { pointerId: 1, clientX: 105, clientY: 100 });
    await flushRaf();

    const duringDrag = snapshot(getDoc())[0];
    expect(duringDrag.x).toBe(before.x + 5); // drag started: moved by the delta
    fireEvent.pointerCancel(note, { pointerId: 1, clientX: 105, clientY: 100 });
    await flushRaf();

    const after = snapshot(getDoc())[0];
    expect(after.x).toBe(duringDrag.x);
    expect(after.y).toBe(duringDrag.y);
    expect(note.hasAttribute('data-selected')).toBe(true);
  });

  it('TC-22: clicking empty board space clears the selection and hides the toolbar', async () => {
    const user = userEvent.setup();
    const [note] = await createNoteByDblClick();
    await user.keyboard('{Escape}'); // selected
    expect(note.hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();

    await user.click(screen.getByTestId('board-viewport'));

    expect(note.hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-25: Delete removes the selected note', async () => {
    const user = userEvent.setup();
    await createNoteByDblClick();
    await user.keyboard('{Escape}');
    expect(snapshot(getDoc())).toHaveLength(1);

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(snapshot(getDoc())).toHaveLength(0);
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(0);
  });

  it('TC-25: Backspace removes the selected note', async () => {
    const user = userEvent.setup();
    await createNoteByDblClick();
    await user.keyboard('{Escape}');
    expect(snapshot(getDoc())).toHaveLength(1);

    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(snapshot(getDoc())).toHaveLength(0);
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(0);
  });

  it('TC-35: dblclick on an existing note does not create a new one; it edits the existing', async () => {
    const user = userEvent.setup();
    const [note] = await createNoteByDblClick();
    await user.keyboard('{Escape}');
    expect(snapshot(getDoc())).toHaveLength(1);

    fireEvent.doubleClick(note, { clientX: 0, clientY: 0 });

    expect(snapshot(getDoc())).toHaveLength(1);
    expect(screen.getByTestId('sticky-text-editor')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Sticky note text' })).toBeTruthy();
  });

  it('TC-36: Enter with nothing selected creates nothing', () => {
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(snapshot(getDoc())).toHaveLength(0);
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(0);
  });

  it('TC-37: a note deleted while Dragging ends the interaction silently (no crash, no recreation)', async () => {
    const user = userEvent.setup();
    const [note] = await createNoteByDblClick();
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('board-viewport')); // deselect first

    const id = snapshot(getDoc())[0].id;
    fireEvent.pointerDown(note, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(note, { pointerId: 1, clientX: 110, clientY: 100 });
    await flushRaf();

    deleteObject(getDoc(), id);
    // A late pointer move after deletion must not throw or recreate the note.
    fireEvent.pointerMove(note, { pointerId: 1, clientX: 120, clientY: 100 });
    fireEvent.pointerUp(note, { pointerId: 1, clientX: 120, clientY: 100 });
    await flushRaf();

    expect(snapshot(getDoc())).toHaveLength(0);
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(0);
  });

  it('TC-37: a note deleted while Editing ends the interaction silently (no crash, no recreation)', async () => {
    const [note] = await createNoteByDblClick();
    expect(screen.getByTestId('sticky-text-editor')).toBeTruthy();

    const id = snapshot(getDoc())[0].id;
    deleteObject(getDoc(), id);
    // Typing after deletion must not throw or recreate the note.
    fireEvent.keyDown(note, { key: 'a' });
    await flushRaf();

    expect(snapshot(getDoc())).toHaveLength(0);
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(0);
  });
});
