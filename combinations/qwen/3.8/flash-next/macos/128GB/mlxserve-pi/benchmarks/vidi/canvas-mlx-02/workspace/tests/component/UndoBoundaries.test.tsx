// Story 8, undo.boundaries (component part) — the wiring, in jsdom, of a real
// controller inside the real board: a drag whose frames land one after another is
// ONE step, the action that follows it is a DIFFERENT step even when it happens
// inside the capture window, and what is typed into a note is undone by Ctrl+Z
// typed inside that note (tasks 9).
//
// The steps are counted the way a person counts them: by pressing the board's own
// Undo button and looking at the board afterwards. That is deliberate - the
// history lives in a controller the board creates for itself, and the only thing a
// user can observe is how many presses a change takes to take back, and what is
// still standing when it does. Real animation frames are awaited rather than faked,
// so the frames the gesture writes are the ones the controller captured.
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  renderBoard7,
  settle,
  act,
  fireEvent,
  screen,
  type Board7Harness,
  type Seed,
} from './story7TestUtils.tsx';
import { colorOf, hex } from './stickyTestUtils.tsx';
import { createSticky, objectsMapOf, type ObjectSnapshot } from '../../src/shared/board-model.ts';
import { STICKY_SIZE_WORLD } from '../../src/shared/config.ts';

interface Pt {
  x: number; y: number;
}

/** What an update from somewhere else arrives with: not this tab's origin. */
const FROM_ELSEWHERE: unique symbol = Symbol('test.provider');

/**
 * Notes as a board receives them when someone opens it: written elsewhere and
 * applied here through an origin this tab did not act with. Nothing written this
 * way is this tab's own work, so none of it is ever offered back as something to
 * undo - which is the difference between this helper and writing into the doc
 * directly.
 */
function loadNotes(doc: Y.Doc, notes: Seed[]): string[] {
  const source = new Y.Doc();
  const ids: string[] = [];
  source.transact(() => {
    for (const note of notes) {
      const id = createSticky(
        source,
        { x: note.x + (note.width ?? STICKY_SIZE_WORLD) / 2, y: note.y + (note.height ?? STICKY_SIZE_WORLD) / 2 },
        note.color ?? 'yellow',
      );
      const map = objectsMapOf(source).get(id);
      if (!map) throw new Error('the note did not reach the source board');
      if (note.text !== undefined) (map.get('text') as Y.Text).insert(0, note.text);
      ids.push(id);
    }
  });
  act(() => {
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(source), FROM_ELSEWHERE);
  });
  return ids;
}

function undoButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
}

function redoButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
}

function canUndo(): boolean {
  return undoButton().disabled !== true;
}

function canRedo(): boolean {
  return redoButton().disabled !== true;
}

/** Press Undo `n` times; every press is one step back, and fails if it is inert. */
async function undo(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    const button = undoButton();
    if (button.disabled) throw new Error(`Undo was disabled after ${i} press(es)`);
    fireEvent.click(button);
  }
  await settle();
}

async function redo(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    const button = redoButton();
    if (button.disabled) throw new Error(`Redo was disabled after ${i} press(es)`);
    fireEvent.click(button);
  }
  await settle();
}

/** Select one note with a short press, and a second one with Shift. */
function selectTwo(h: Board7Harness, a: string, b: string, pa: Pt, pb: Pt): void {
  h.press(h.object(a)!, pa.x, pa.y);
  h.release(h.object(a)!, pa.x, pa.y);
  h.press(h.object(b)!, pb.x, pb.y, { shiftKey: true, pointerId: 2 });
  h.release(h.object(b)!, pb.x, pb.y, { shiftKey: true, pointerId: 2 });
}

/**
 * A drag in which the frames really run: the pointer moves `frames` times and every
 * fifth move yields for an animation frame, which is how a drag reaches the model -
 * in writes scheduled off the pointer events, not in the events themselves.
 */
async function dragWithFrames(
  h: Board7Harness,
  el: HTMLElement,
  from: Pt,
  to: Pt,
  frames = 30,
): Promise<void> {
  h.press(el, from.x, from.y);
  for (let i = 1; i <= frames; i++) {
    const t = i / frames;
    h.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    if (i % 5 === 0) await h.frames(1);
  }
  h.release(el, to.x, to.y);
  await settle();
}

function noteText(h: Board7Harness, id: string): string {
  return h.snapshot().find((o: ObjectSnapshot) => o.id === id)?.text ?? '';
}

describe('undo steps of the real board (undo.boundaries)', () => {
  // TC-14: thirty frames of one drag of a two-object selection come back with a
  // single press, on every object of that selection.
  it('TC-14 takes a thirty-frame drag of the selection back in one step', async () => {
    const h = renderBoard7();
    const [a, b] = loadNotes(h.doc(), [{ x: 0, y: 0 }, { x: 400, y: 0 }]) as [string, string];
    await settle();
    // Nothing on this board was done here, so there is nothing to take back yet.
    expect(canUndo()).toBe(false);

    selectTwo(h, a, b, { x: 50, y: 50 }, { x: 450, y: 50 });
    await dragWithFrames(h, h.object(a)!, { x: 50, y: 50 }, { x: 200, y: 150 });

    expect(h.pos(h.object(a)!)).toEqual({ x: 150, y: 100 });
    expect(h.pos(h.object(b)!)).toEqual({ x: 550, y: 100 });

    // One press, both notes home: the frames were one step, not thirty.
    await undo(1);
    expect(h.pos(h.object(a)!)).toEqual({ x: 0, y: 0 });
    expect(h.pos(h.object(b)!)).toEqual({ x: 400, y: 0 });
    expect(h.notes()).toHaveLength(2);
    // That was the only thing this board did, and now there is nothing left back.
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);

    // ...and Redo puts the whole gesture back the same way.
    await redo(1);
    expect(h.pos(h.object(a)!)).toEqual({ x: 150, y: 100 });
    expect(h.pos(h.object(b)!)).toEqual({ x: 550, y: 100 });
    expect(canRedo()).toBe(false);
  });

  // TC-15: a colour chosen two hundred milliseconds after the drag let go - well
  // inside the capture window - is a step of its own, because the gesture closed
  // its step when the pointer came up.
  it('TC-15 keeps a colour chosen just after a drag as a separate step', async () => {
    const h = renderBoard7();
    const [a] = loadNotes(h.doc(), [{ x: 0, y: 0 }]) as [string];
    await settle();

    h.press(h.object(a)!, 50, 50);
    h.release(h.object(a)!, 50, 50);
    h.drag(h.object(a)!, { x: 50, y: 50 }, { x: 200, y: 50 });
    await settle();
    expect(h.pos(h.object(a)!)).toEqual({ x: 150, y: 0 });

    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    fireEvent.click(screen.getByTestId('swatch-blue'));
    await settle();
    expect(colorOf(h.object(a)!)).toBe(hex('blue'));

    // Undo takes the colour back and leaves the move standing: two actions, two
    // steps - which is exactly what a bare capture window could not do.
    await undo(1);
    expect(colorOf(h.object(a)!)).toBe(hex('yellow'));
    expect(h.pos(h.object(a)!)).toEqual({ x: 150, y: 0 });
    // One step is gone and one is left: two actions were made, two were offered.
    expect(canUndo()).toBe(true);

    await undo(1);
    expect(h.pos(h.object(a)!)).toEqual({ x: 0, y: 0 });
    expect(canUndo()).toBe(false);
  });

  // TC-16: Ctrl+Z typed inside the note's own editor undoes what was typed there.
  // The move that happened before the editor opened is a different step and stays
  // (negative), and the textarea is left showing the document rather than the
  // browser's own idea of the text.
  it('TC-16 undoes the typing of a note from inside it, not the move before it', async () => {
    const h = renderBoard7();
    const [a] = loadNotes(h.doc(), [{ x: 0, y: 0, text: 'seed' }]) as [string];
    await settle();

    h.press(h.object(a)!, 50, 50);
    h.release(h.object(a)!, 50, 50);
    h.drag(h.object(a)!, { x: 50, y: 50 }, { x: 250, y: 50 });
    await settle();
    expect(h.pos(h.object(a)!)).toEqual({ x: 200, y: 0 });

    fireEvent.doubleClick(h.object(a)!);
    await settle();
    const editor = screen.queryByTestId('sticky-editor') as HTMLTextAreaElement | null;
    if (!editor) throw new Error('the note did not open its editor');
    expect(editor.value).toBe('seed');

    // Five keystrokes, one after another: one burst, one step.
    for (const char of 'hello') {
      const next = editor.value + char;
      editor.value = next;
      fireEvent.input(editor, { target: { value: next } });
    }
    await settle();
    expect(noteText(h, a)).toBe('seedhello');

    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    await settle();

    expect(noteText(h, a)).toBe('seed');
    expect(editor.value).toBe('seed');
    // The move is one step further down and was not touched: one keystroke in the
    // note, one step back.
    expect(h.pos(h.object(a)!)).toEqual({ x: 200, y: 0 });
    expect(h.object(a)).not.toBeNull();

    // What was typed comes back with Redo, and the note keeps its place.
    await redo(1);
    expect(noteText(h, a)).toBe('seedhello');
    expect(h.pos(h.object(a)!)).toEqual({ x: 200, y: 0 });
  });

  // TC-17 (error path): the browser takes the pointer away in the middle of a
  // drag. The drag is not rolled back, it is kept as one step, and one press
  // restores where it started.
  it('TC-17 keeps a drag the browser cancelled in one step', async () => {
    const h = renderBoard7();
    const [a] = loadNotes(h.doc(), [{ x: 0, y: 0 }]) as [string];
    await settle();

    h.press(h.object(a)!, 50, 50);
    h.release(h.object(a)!, 50, 50);

    h.press(h.object(a)!, 50, 50);
    h.move(120, 80);
    await h.frames(1);
    h.move(190, 130);
    await h.frames(1);
    fireEvent.pointerCancel(window, { pointerId: 1, bubbles: true, cancelable: true });
    await settle();

    // Where the pointer was last seen, not where it started.
    expect(h.pos(h.object(a)!)).toEqual({ x: 140, y: 80 });
    expect(canUndo()).toBe(true);

    await undo(1);
    expect(h.pos(h.object(a)!)).toEqual({ x: 0, y: 0 });
    expect(canUndo()).toBe(false);
  });

  // The buttons are the readout of the history: a board that was only opened has
  // nothing of this person's own to undo, however many notes are on it, and the
  // first thing they do is the only thing offered back.
  it('offers nothing to undo on a board it only opened', async () => {
    const h = renderBoard7();
    const [a] = loadNotes(h.doc(), [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 800, y: 0 }]) as [string, string, string];
    await settle();
    expect(h.notes()).toHaveLength(3);
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);

    h.press(h.object(a)!, 50, 50);
    h.release(h.object(a)!, 50, 50);
    h.drag(h.object(a)!, { x: 50, y: 50 }, { x: 120, y: 50 });
    await settle();
    expect(canUndo()).toBe(true);

    await undo(1);
    expect(canUndo()).toBe(false);
    expect(h.notes()).toHaveLength(3);
    expect(h.pos(h.object(a)!)).toEqual({ x: 0, y: 0 });
  });

  // A delete, an undo that brings the note back, and the redo that takes it away
  // again - through the note's own toolbar buttons, which is where a person does
  // this.
  it('undo restores what the note toolbar deleted and redo deletes it again', async () => {
    const h = renderBoard7();
    const [a, b] = loadNotes(h.doc(), [{ x: 0, y: 0 }, { x: 400, y: 0 }]) as [string, string];
    await settle();

    h.press(h.object(a)!, 50, 50);
    h.release(h.object(a)!, 50, 50);
    fireEvent.click(screen.getByTestId('note-delete'));
    await settle();
    expect(h.notes()).toHaveLength(1);

    await undo(1);
    expect(h.notes()).toHaveLength(2);
    expect(h.object(a)).not.toBeNull();
    expect(h.pos(h.object(a)!)).toEqual({ x: 0, y: 0 });

    await redo(1);
    expect(h.notes()).toHaveLength(1);
    expect(h.object(a)).toBeNull();
    // The other note, which was never touched, is where it always was.
    expect(h.pos(h.object(b)!)).toEqual({ x: 400, y: 0 });
  });

  // Nothing was created here, so nothing was merged with it: two notes created
  // from the toolbar are two steps, and undoing one leaves the other standing -
  // always the earlier one, because undo walks backwards.
  it('undoes two notes created from the toolbar one at a time', async () => {
    const h = renderBoard7();
    await settle();

    fireEvent.click(screen.getByTestId('sticky-create'));
    act(() => {
      fireEvent.keyDown(screen.getByTestId('sticky-editor')!, { key: 'Escape', bubbles: true });
    });
    await settle();
    fireEvent.click(screen.getByTestId('sticky-create'));
    act(() => {
      fireEvent.keyDown(screen.getByTestId('sticky-editor')!, { key: 'Escape', bubbles: true });
    });
    await settle();
    expect(h.notes()).toHaveLength(2);

    await undo(1);
    expect(h.notes()).toHaveLength(1);
    await undo(1);
    expect(h.notes()).toHaveLength(0);
  });
});
