import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Board } from '../../src/client/board/Board';
import type { SeedNote } from '../../src/client/canvas/testHooks';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config';
import { TEST_BOARD_ID, dispatchKey, dispatchPointer, flushFrame } from './util';
import {
  clickElement,
  clickWithPointer,
  dispatchDblClick,
  getSnapshot,
  hook,
  noteEl,
  press,
  typeText,
} from './stickyUtil';

/**
 * Story 8 — undo step boundaries in the board (undo.steps, undo.typing).
 *
 * A real `Board`, a real document and a real controller: what is under test is the
 * wiring — where a step begins and ends — so the gestures are the same pointer
 * events the browser produces and the assertions are "one undo brought everything
 * back", not "a method was called".
 */

/** Write fixture notes nobody has to undo (they arrived like a saved board). */
function seed(specs: readonly SeedNote[]): string[] {
  let ids: string[] = [];
  act(() => {
    ids = hook().seedNotes(specs);
  });
  return ids;
}

/** The history the toolbar buttons and shortcuts drive. */
function undoStep(): boolean {
  let done = false;
  act(() => {
    done = hook().undo();
  });
  return done;
}

function redoStep(): boolean {
  let done = false;
  act(() => {
    done = hook().redo();
  });
  return done;
}

const noteById = (id: string) => getSnapshot().find((n) => n.id === id)!;
const place = (id: string) => {
  const n = noteById(id);
  return { x: n.x, y: n.y };
};

/**
 * Press on a note and walk to `to` in `steps`, committing animation frames on the
 * way: a real drag writes a `moveObjects` transaction per frame, and that is exactly
 * what must not become 30 undo steps.
 */
async function dragThroughFrames(
  el: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 30,
  end: 'pointerup' | 'pointercancel' = 'pointerup',
): Promise<void> {
  dispatchPointer(el, 'pointerdown', { pointerId: 1, clientX: from.x, clientY: from.y });
  const windowEl = window as unknown as Element;
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    dispatchPointer(windowEl, 'pointermove', { pointerId: 1, clientX: x, clientY: y });
    if (i % 5 === 0) await flushFrame();
  }
  dispatchPointer(windowEl, end, {
    pointerId: 1,
    clientX: to.x,
    clientY: to.y,
  });
  await flushFrame();
}

const AT = { x: 60, y: 60 };

describe('undo.steps — one action, one undo step', () => {
  // TC-14: a 30-frame drag of a selection of three notes is one step (undo.steps).
  it('TC-14 returns every moved note to its starting place with one undo', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const ids = seed([
      { x: 60, y: 60, color: 'yellow', text: 'one' },
      { x: 300, y: 120, color: 'blue', text: 'two' },
      { x: 180, y: 320, color: 'green', text: 'three' },
    ]);
    await flushFrame();
    const start = ids.map(place);

    // The whole selection moves together.
    dispatchKey({ key: 'a', ctrlKey: true });
    await dragThroughFrames(noteEl(0), { x: 100, y: 100 }, { x: 100 + DRAG_THRESHOLD_PX * 20, y: 100 });

    const dragged = ids.map(place);
    expect(dragged[0]!.x).toBeCloseTo(start[0]!.x + DRAG_THRESHOLD_PX * 20, 6);
    expect(dragged[1]!.x).toBeCloseTo(start[1]!.x + DRAG_THRESHOLD_PX * 20, 6);
    expect(dragged).not.toEqual(start);

    expect(hook().canUndo()).toBe(true);
    expect(undoStep()).toBe(true);
    await flushFrame();
    // One step reversed the whole gesture: all three are back where they started.
    expect(ids.map(place)).toEqual(start);
    // …and there was nothing else in the history, so that was the only step.
    expect(hook().canUndo()).toBe(false);
    expect(undoStep()).toBe(false);
  });

  // TC-15: a colour change straight after a drag is a second step, not part of it.
  it('TC-15 keeps the drag and the colour change that follows as two steps', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const [id] = seed([{ x: 60, y: 60, color: 'yellow', text: 'move me' }]);
    await flushFrame();
    const start = place(id!);

    // Drag, then recolour immediately (well inside the 500 ms capture window).
    clickWithPointer(noteEl(0), AT);
    await dragThroughFrames(noteEl(0), { x: 80, y: 80 }, { x: 80 + DRAG_THRESHOLD_PX * 10, y: 80 });
    const dragged = place(id!);
    expect(dragged).not.toEqual(start);

    await clickElement(screen.getByTestId('color-blue'));
    await flushFrame();
    expect(noteById(id!).color).toBe('blue');

    // The first undo gives the colour back and leaves the move alone: they were two.
    expect(undoStep()).toBe(true);
    await flushFrame();
    expect(noteById(id!).color).toBe('yellow');
    expect(place(id!)).toEqual(dragged);

    // The second undo gives the place back: that was the drag.
    expect(undoStep()).toBe(true);
    await flushFrame();
    expect(place(id!)).toEqual(start);
    expect(hook().canUndo()).toBe(false);

    // Redo steps forward through the same two, in order.
    expect(redoStep()).toBe(true);
    await flushFrame();
    expect(place(id!)).toEqual(dragged);
    expect(noteById(id!).color).toBe('yellow');
    expect(redoStep()).toBe(true);
    await flushFrame();
    expect(noteById(id!).color).toBe('blue');
    expect(hook().canRedo()).toBe(false);
  });

  // TC-16: Ctrl/Cmd+Z inside a note's editor takes back the typing, not the earlier move.
  it('TC-16 undoes typing inside the note and leaves the earlier move alone', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const [id] = seed([{ x: 60, y: 60, color: 'yellow', text: 'kept' }]);
    await flushFrame();
    const start = place(id!);

    clickWithPointer(noteEl(0), AT);
    await dragThroughFrames(noteEl(0), { x: 80, y: 80 }, { x: 80, y: 80 + DRAG_THRESHOLD_PX * 10 });
    const dragged = place(id!);
    expect(dragged).not.toEqual(start);

    // Type one burst: no pause, so it is one step of its own (undo.typing).
    dispatchDblClick(noteEl(0), AT);
    await flushFrame();
    const box = screen.getByTestId('sticky-note-input') as HTMLTextAreaElement;
    await typeText('hello');
    await flushFrame();
    // The caret starts at the end of the text, so the burst lands after it.
    expect(noteById(id!).text).toBe('kepthello');

    // Ctrl+Z *inside* the editor: the burst goes, the move from before stays.
    await press('{Control>}z{/Control}');
    await flushFrame();
    expect(noteById(id!).text).toBe('kept');
    expect(box.value).toBe('kept');
    expect(place(id!)).toEqual(dragged);

    // Leaving the note, the next undo continues with the earlier action.
    await press('{Escape}');
    await flushFrame();
    expect(undoStep()).toBe(true);
    await flushFrame();
    expect(place(id!)).toEqual(start);
  });

  // TC-17: a cancelled drag is still one step (error path).
  it('TC-17 undoes a drag that was cancelled halfway through', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const [id] = seed([{ x: 60, y: 60, color: 'orange', text: 'half way' }]);
    await flushFrame();
    const start = place(id!);

    clickWithPointer(noteEl(0), AT);
    await dragThroughFrames(
      noteEl(0),
      { x: 80, y: 80 },
      { x: 80 + DRAG_THRESHOLD_PX * 12, y: 80 },
      30,
      'pointercancel',
    );
    const partWay = place(id!);
    expect(partWay).not.toEqual(start);

    expect(undoStep()).toBe(true);
    await flushFrame();
    expect(place(id!)).toEqual(start);
    // The cancelled drag never became two steps.
    expect(hook().canUndo()).toBe(false);
  });
});
