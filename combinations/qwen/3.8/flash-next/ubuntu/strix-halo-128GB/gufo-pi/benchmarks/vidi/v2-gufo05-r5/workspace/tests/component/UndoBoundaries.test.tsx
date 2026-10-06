/**
 * Story 8, `undo.boundaries` in the running app (TC-14 to TC-17).
 *
 * What makes a step is decided at the edges of gestures and editing sessions, so these tests drive
 * the real interface - the real drag gesture, the real note toolbar, the real text field - and read
 * the result back out of the document the app itself holds.
 */
import { act, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { describe, expect, test } from 'vitest';
import { NUDGE_STEP_WORLD } from '../../src/shared/config';
import { dispatchKey, renderBoard, runFrames } from './helpers';
import {
  colleague,
  dragNote,
  mineMove,
  mineNote,
  noteElement,
  noteOf,
  notes,
  placeOf,
  redoButton,
  tapNote,
  textOf,
  theirs,
  undoButton,
} from './undoHarness';

async function clickUndo(): Promise<void> {
  await act(async () => {
    fireEvent.click(undoButton());
  });
}

/** Creates a note with the toolbar, so the note and whatever is typed into it are separate. */
async function createNoteWithToolbar(): Promise<string> {
  const before = new Set((window.__vidi6?.getNotes() ?? []).map((note) => note.id));
  await act(async () => {
    fireEvent.click(screen.getByTestId('create-sticky-button'));
  });
  await runFrames();
  const added = (window.__vidi6?.getNotes() ?? []).find((note) => !before.has(note.id));
  if (!added) throw new Error('the Sticky note button did not create a note');
  return added.id;
}

describe('undo.boundaries in the app', () => {
  test('TC-14 a 30-frame drag is one step, and undo restores where it started', async () => {
    renderBoard();
    const id = await mineNote(0, 0);
    const started = placeOf(id);

    await dragNote(id, { x: 300, y: 300 }, { x: 620, y: 460 }, 30);

    const moved = placeOf(id);
    expect(moved.slice(0, 2)).not.toEqual(started.slice(0, 2));

    await clickUndo();

    // one press of undo, back to the start: the 30 pointer moves did not make 30 steps, and the
    // raise to the front that came with the drag went back with it
    expect(placeOf(id)).toEqual(started);
    expect(redoButton()).toBeEnabled();
  });

  test('TC-15 a move followed straight afterwards by a colour is two steps', async () => {
    renderBoard();
    const id = await mineNote(0, 0);
    const started = placeOf(id);

    await dragNote(id, { x: 300, y: 300 }, { x: 480, y: 360 }, 12);
    const moved = placeOf(id);

    // straight after the drag, well inside the capture window, this picks a colour
    const toolbar = within(noteElement(id)).getByTestId('note-toolbar');
    await act(async () => {
      fireEvent.click(within(toolbar).getByLabelText('Blue colour'));
    });
    expect(noteOf(id).color).toBe('blue');

    await clickUndo();
    // the colour came back on its own, and the note is still where it was dragged to
    expect(noteOf(id).color).toBe('yellow');
    expect(placeOf(id).slice(0, 2)).toEqual(moved.slice(0, 2));

    await clickUndo();
    expect(placeOf(id)).toEqual(started);
  });

  test('TC-16 Ctrl+Z inside the note undoes the typing and leaves the earlier move alone', async () => {
    renderBoard();
    const id = await createNoteWithToolbar();
    // leave editing, so what is typed next session is not part of creating the note
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('sticky-note-input'), { key: 'Escape' });
    });
    await runFrames();

    await mineMove(id, 120, 90);
    const moved = placeOf(id);

    await act(async () => {
      fireEvent.doubleClick(noteElement(id), { clientX: 300, clientY: 300 });
    });
    await runFrames();

    const field = screen.getByTestId('sticky-note-input');
    // three keystrokes in a row: one step
    fireEvent.change(field, { target: { value: 'R' } });
    fireEvent.change(field, { target: { value: 'Ro' } });
    fireEvent.change(field, { target: { value: 'Rog' } });
    expect(textOf(id)).toBe('Rog');

    const event = dispatchKey(field, { key: 'z', ctrlKey: true });

    // the field's own undo is switched off, and the burst went back as one step
    expect(event.defaultPrevented).toBe(true);
    expect(textOf(id)).toBe('');
    expect((field as HTMLTextAreaElement).value).toBe('');
    // editing did not close and the caret did not leave: undo here is a keystroke, not a command
    expect(document.activeElement).toBe(field);

    // the move made before editing is untouched, and is still the next step back
    expect(placeOf(id).slice(0, 2)).toEqual(moved.slice(0, 2));
    await clickUndo();
    expect(placeOf(id)).not.toEqual(moved);
    expect(textOf(id)).toBe('');
  });

  test('TC-17 a drag cancelled halfway is one step that restores the start', async () => {
    renderBoard();
    const id = await mineNote(0, 0);
    const started = placeOf(id);

    await dragNote(id, { x: 300, y: 300 }, { x: 520, y: 420 }, 10, 'cancel');

    const moved = placeOf(id);
    expect(moved.slice(0, 2)).not.toEqual(started.slice(0, 2));

    await clickUndo();
    expect(placeOf(id)).toEqual(started);
  });

  test('TC-17b undoing my nudge leaves the note where it is and keeps the colleague colour', async () => {
    renderBoard();
    const id = await mineNote(0, 0);
    await mineNote(400, 400); // a second note, which must not be swept up by the undo

    // a nudge is its own step, taken after the two notes were made
    await tapNote(id);
    const parked = placeOf(id);
    dispatchKey(window, { key: 'ArrowRight' });
    const nudged = placeOf(id);
    expect(nudged[0]).toBe(parked[0] + NUDGE_STEP_WORLD);

    // on the same note, the colleague picks a colour
    const raj = colleague();
    await theirs(raj, id, { color: 'pink' });

    await clickUndo();
    // my step went back on its own: the note is still here, still theirs-to-colour, one nudge short
    expect(noteOf(id).color).toBe('pink');
    expect(placeOf(id)).toEqual(parked);
    expect(notes()).toHaveLength(2);
  });
});
