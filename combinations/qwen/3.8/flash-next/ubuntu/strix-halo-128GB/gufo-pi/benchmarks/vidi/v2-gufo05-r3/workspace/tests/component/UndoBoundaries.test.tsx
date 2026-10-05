import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import type { Doc, Transaction } from 'yjs';
import { objectBounds, getStickyText, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import type { Point } from '../../src/client/canvas/camera';
import {
  noteEl,
  renderBoard,
  seedSticky,
  stubViewportSize,
  textarea,
} from './boardHarness';

/**
 * Story 8, `undo.boundaries`: what one undo step is.
 *
 * These run through the whole board — the real gesture, the real text editor, the
 * real toolbar — because a step is defined by where the board puts its
 * boundaries, not by what the controller would have done on its own. Undo and
 * redo are driven through the buttons, so a step is only "one step" if pressing
 * Undo once reverses exactly that action.
 */

stubViewportSize();

/**
 * Wait for the next animation frame — the gesture writes once per frame — and
 * let React settle, so the state the write causes is applied before the test
 * carries on. The frame has to be waited for *twice*: once for the write, once
 * for whatever the write made the board re-render.
 */
async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Press at `from`, move to `to` over `frames` pointer moves — one per animation
 * frame — and release. Crossing frame boundaries is the point: the drag writes a
 * transaction per frame, which the capture window has to gather into one step.
 */
async function dragFrames(
  el: HTMLElement,
  from: Point,
  to: Point,
  frames: number,
  end: 'up' | 'cancel' = 'up',
): Promise<void> {
  const init = { button: 0, pointerId: 3 };
  fireEvent.pointerDown(el, { ...init, clientX: from.x, clientY: from.y });
  for (let step = 1; step <= frames; step += 1) {
    fireEvent.pointerMove(el, {
      ...init,
      buttons: 1,
      clientX: from.x + ((to.x - from.x) * step) / frames,
      clientY: from.y + ((to.y - from.y) * step) / frames,
    });
    await nextFrame();
  }
  const last = end === 'up' ? fireEvent.pointerUp : fireEvent.pointerCancel;
  last(el, { ...init, clientX: to.x, clientY: to.y });
}

function note(doc: Doc, id: string): StickySnapshot {
  const found = snapshot(doc).find((object) => object.id === id);
  if (!found) throw new Error(`note ${id} is gone`);
  return found as StickySnapshot;
}

const undoButton = () => screen.getByRole('button', { name: 'Undo' });
const redoButton = () => screen.getByRole('button', { name: 'Redo' });

/** Count the transactions that really changed the board (a drag makes many). */
function countWrites(doc: Doc): () => number {
  let writes = 0;
  const listener = (transaction: Transaction) => {
    if (transaction.changedParentTypes.size > 0) writes += 1;
  };
  doc.on('afterTransaction', listener);
  return () => {
    doc.off('afterTransaction', listener);
    return writes;
  };
}

describe('one action is one undo step (undo.boundaries)', () => {
  it('TC-14 a thirty frame drag is one undo step', async () => {
    const doc = new Y.Doc();
    const id = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);
    const start = objectBounds(note(doc, id));
    const writes = countWrites(doc);

    await dragFrames(noteEl(container, id), { x: 300, y: 300 }, { x: 360, y: 330 }, 30);

    // The drag was not one lucky write: without the capture window these would
    // be dozens of steps.
    expect(writes()).toBeGreaterThanOrEqual(5);
    const moved = objectBounds(note(doc, id));
    expect(moved.x).toBeCloseTo(start.x + 60, 3);

    fireEvent.click(undoButton());

    const restored = objectBounds(note(doc, id));
    expect(restored.x).toBeCloseTo(start.x, 3);
    expect(restored.y).toBeCloseTo(start.y, 3);
    // Nothing of mine is left: the drag was a single step.
    expect(undoButton()).toBeDisabled();
  });

  it('TC-14 undoing a drag also puts the note back in the pile it was in', async () => {
    const doc = new Y.Doc();
    const first = seedSticky(doc, { x: 0, y: 0 });
    const second = seedSticky(doc, { x: 40, y: 0 });
    const { container } = renderBoard(doc);
    const start = objectBounds(note(doc, first));
    expect(snapshot(doc).map((object) => object.id)).toEqual([first, second]);

    // Pressing on the first note raises it to the front of the pile.
    await dragFrames(noteEl(container, first), { x: 300, y: 300 }, { x: 340, y: 320 }, 4);
    expect(snapshot(doc).map((object) => object.id)).toEqual([second, first]);

    fireEvent.click(undoButton());

    // One step: the move and the raise went together.
    expect(snapshot(doc).map((object) => object.id)).toEqual([first, second]);
    expect(objectBounds(note(doc, first)).x).toBeCloseTo(start.x, 3);
  });

  it('TC-15 a colour change right after a drag is its own step', async () => {
    const doc = new Y.Doc();
    const id = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);

    const start = objectBounds(note(doc, id));

    await dragFrames(noteEl(container, id), { x: 300, y: 300 }, { x: 380, y: 340 }, 6);
    const moved = objectBounds(note(doc, id));

    // No pause: the capture window would have merged the two if the gesture had
    // not closed it on release.
    fireEvent.click(screen.getByRole('button', { name: 'Blue colour' }));
    expect(note(doc, id).color).toBe('blue');

    fireEvent.click(undoButton());
    expect(note(doc, id).color).toBe('yellow');
    expect(objectBounds(note(doc, id)).x).toBeCloseTo(moved.x, 3);

    fireEvent.click(undoButton());
    expect(objectBounds(note(doc, id)).x).toBeCloseTo(start.x, 3);
    expect(undoButton()).toBeDisabled();
  });

  it('TC-16 a burst of typing is one step and does not undo the move before it', async () => {
    const user = userEvent.setup();
    const doc = new Y.Doc();
    const id = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);

    const start = objectBounds(note(doc, id));
    await dragFrames(noteEl(container, id), { x: 300, y: 300 }, { x: 420, y: 300 }, 6);
    const moved = objectBounds(note(doc, id));

    fireEvent.doubleClick(noteEl(container, id));
    const box = textarea(container);
    if (!box) throw new Error('the note did not open for editing');
    await user.type(box, 'hello');
    expect(getStickyText(doc, id)?.toString()).toBe('hello');

    // Ctrl+Z while still typing: the browser's own undo would rewind the
    // textarea alone, so the board's history is stepped instead.
    await user.keyboard('{Control>}z{/Control}');
    expect(getStickyText(doc, id)?.toString()).toBe('');
    // The typing was five keystrokes and came back as one step.
    expect(redoButton()).toBeEnabled();
    expect(objectBounds(note(doc, id)).x).toBeCloseTo(moved.x, 3);

    // A second step back reaches the move, and nothing was skipped.
    await user.keyboard('{Control>}z{/Control}');
    expect(objectBounds(note(doc, id)).x).toBeCloseTo(start.x, 3);
  });

  it('TC-16 typing after a colleague edited the same note undoes only my typing', async () => {
    const user = userEvent.setup();
    const doc = new Y.Doc();
    const id = seedSticky(doc, { x: 0, y: 0 }, { text: 'from a colleague' });
    const { container } = renderBoard(doc);

    fireEvent.doubleClick(noteEl(container, id));
    const box = textarea(container);
    if (!box) throw new Error('the note did not open for editing');
    // The caret goes to the end of the colleague's text, which is where a person
    // who just double-clicked would type.
    box.setSelectionRange(box.value.length, box.value.length);
    await user.type(box, '!');
    expect(getStickyText(doc, id)?.toString()).toBe('from a colleague!');

    await user.keyboard('{Control>}z{/Control}');
    expect(getStickyText(doc, id)?.toString()).toBe('from a colleague');
  });

  it('TC-17 a gesture cancelled mid-drag is one step back to where it started', async () => {
    const doc = new Y.Doc();
    const id = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);

    const start = objectBounds(note(doc, id));
    await dragFrames(
      noteEl(container, id),
      { x: 300, y: 300 },
      { x: 330, y: 315 },
      10,
      'cancel',
    );
    // Story 7: the last position shown stays shown; nothing rewinds on its own.
    const shown = objectBounds(note(doc, id));
    expect(shown.x).toBeGreaterThan(start.x);

    fireEvent.click(undoButton());
    expect(objectBounds(note(doc, id)).x).toBeCloseTo(start.x, 3);
    expect(objectBounds(note(doc, id)).y).toBeCloseTo(start.y, 3);
    expect(undoButton()).toBeDisabled();
  });
});
