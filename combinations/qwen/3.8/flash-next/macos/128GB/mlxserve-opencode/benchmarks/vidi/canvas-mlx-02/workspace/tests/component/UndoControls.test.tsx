// Story 8, undo.controls (component) — the two controls and the keys that drive
// them: they are greyed out exactly when there is nothing on this person's side of
// the history, they say what they do and what to press, and the keys are taken only
// where taking them is the right thing to do (tasks 11).
//
// The buttons are checked twice: on their own, with a history handed to them, so
// that their enabled state is tested rather than inferred; and in the real board,
// where what enables them is a change that really happened and what disables them is
// an undo that really undid it. The keys are checked only in the real board, because
// what decides a key is the whole route it travels: the screen, the field holding the
// focus, and whether this person is allowed to edit at all.
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { renderBoard7, seedSticky, settle } from './story7TestUtils.tsx';
import { Toolbar } from '../../src/client/board/Toolbar.tsx';
import { useBoardKeys } from '../../src/client/board/useBoardKeys.ts';
import { useSelection } from '../../src/client/board/useSelection.ts';
import { createUndo, type UndoController } from '../../src/client/board/undo.ts';
import {
  createSticky,
  deleteObjects,
  moveObjects,
  objectsMapOf,
  objectsSnapshot,
} from '../../src/shared/board-model.ts';

function button(name: 'Undo' | 'Redo'): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

function isDisabled(name: 'Undo' | 'Redo'): boolean {
  return button(name).disabled === true;
}

/**
 * A keystroke with nothing in particular holding the focus, which is how a keystroke
 * reaches the board: the listener is on the window, so that is where it is sent.
 */
function key(key: string, mods: { ctrl?: boolean; shift?: boolean; meta?: boolean } = {}): boolean {
  return fireEvent.keyDown(window, {
    key,
    ctrlKey: mods.ctrl === true,
    shiftKey: mods.shift === true,
    metaKey: mods.meta === true,
    bubbles: true,
    cancelable: true,
  });
}

/**
 * A text field that has nothing to do with the board, to put the caret in: the rule
 * the keys are gated by is about where the caret is, not about who built the field.
 */
function foreignField(kind: 'input' | 'textarea' = 'input'): HTMLElement {
  const field = document.createElement(kind);
  field.setAttribute('data-testid', 'foreign-field');
  document.body.appendChild(field);
  (field as HTMLInputElement).value = 'something the board never touched';
  (field as HTMLInputElement).focus();
  return field;
}

describe('undo controls on their own (undo.controls)', () => {
  // TC-18: with nothing to go back to and nothing to come forward again, both are
  // greyed out - and neither is missing, so the toolbar does not shift about as the
  // history fills.
  it('TC-18 greys out both controls when the history is empty', () => {
    renderToolbar({ canUndo: false, canRedo: false });
    expect(isDisabled('Undo')).toBe(true);
    expect(isDisabled('Redo')).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Redo' })).toHaveLength(1);
  });

  // Each stands on its own: a history with something behind it and nothing ahead
  // greys only Redo, and the other way round.
  it('enables one control without the other', () => {
    renderToolbar({ canUndo: true, canRedo: false });
    expect(isDisabled('Undo')).toBe(false);
    expect(isDisabled('Redo')).toBe(true);
    cleanup();

    renderToolbar({ canUndo: false, canRedo: true });
    expect(isDisabled('Undo')).toBe(true);
    expect(isDisabled('Redo')).toBe(false);
  });

  // Pressing one steps the history it was given, and the keys are named to anyone
  // who hovers or asks a screen reader - Mac and Windows alike.
  it('pressing a control steps the history it was handed, and names its key', () => {
    const undo = vi.fn();
    const redo = vi.fn();
    renderToolbar({ canUndo: true, canRedo: true, undo, redo });

    fireEvent.click(button('Undo'));
    fireEvent.click(button('Redo'));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);

    // Both spellings of the key are said, so a person on either system can find
    // the key they already know.
    expect(button('Undo').title).toContain('Ctrl+Z');
    expect(button('Undo').title).toContain('Cmd+Z');
    expect(button('Redo').title).toContain('Ctrl+Shift+Z');
    expect(button('Redo').title).toContain('Ctrl+Y');
    expect(button('Redo').title).toContain('Cmd+Shift+Z');
  });

  // A control that has nothing to do does nothing, however often it is pressed: the
  // browser's own idea of Undo is never let through the button.
  it('does nothing when a greyed control is pressed', () => {
    const undo = vi.fn();
    const redo = vi.fn();
    renderToolbar({ canUndo: false, canRedo: false, undo, redo });
    fireEvent.click(button('Undo'));
    fireEvent.click(button('Redo'));
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });
});

/** An origin this tab never acts with: what arrives under it is somebody else's work. */
const ELSEWHERE = Symbol('another tab');

/**
 * Notes as they reach a screen that did not make them: written into a doc of
 * somebody else's and applied here under an origin this tab never acts with, so
 * none of it is this tab's own work and none of it is offered back as a step.
 */
function notesArrivingFromElsewhere(doc: Y.Doc, notes: Array<{ x: number; y: number }>): string[] {
  const source = new Y.Doc();
  const ids: string[] = [];
  source.transact(() => {
    for (const note of notes) ids.push(createSticky(source, { x: note.x + 100, y: note.y + 100 }));
  });
  const update = Y.encodeStateAsUpdate(source);
  act(() => {
    Y.applyUpdate(doc, update, ELSEWHERE);
  });
  return ids;
}

/** A colleague's delete, seen from this side: a write made with an origin that is not ours. */
function deleteFromElsewhere(doc: Y.Doc, id: string): void {
  act(() => {
    doc.transact(() => {
      deleteObjects(doc, [id]);
    }, ELSEWHERE);
  });
}

describe('undo keys in the real board (undo.controls)', () => {
  // TC-19: Ctrl+Z and Ctrl+Shift+Z go to this person's history and nowhere else, and
  // the keystroke is taken from the page so that nothing else can answer it as well.
  // The change that gets undone is one the board really made.
  it('TC-19 takes the keys for undo and redo of the board change', async () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    await settle();

    h.press(h.object(a)!, 50, 50);
    h.release(h.object(a)!, 50, 50);
    h.drag(h.object(a)!, { x: 50, y: 50 }, { x: 170, y: 110 });
    await settle();
    expect(h.pos(h.object(a)!)).toEqual({ x: 120, y: 60 });

    // A keystroke that was handled comes back from fireEvent as `false`: the page
    // was told to leave it alone.
    const undone = key('z', { ctrl: true });
    await settle();
    expect(undone).toBe(false);
    expect(h.pos(h.object(a)!)).toEqual({ x: 0, y: 0 });

    // Ctrl+Y is the Windows spelling of coming forward again.
    const redoneByY = key('y', { ctrl: true });
    await settle();
    expect(redoneByY).toBe(false);
    expect(h.pos(h.object(a)!)).toEqual({ x: 120, y: 60 });

    const undoneAgain = key('z', { ctrl: true });
    await settle();
    expect(undoneAgain).toBe(false);
    expect(h.pos(h.object(a)!)).toEqual({ x: 0, y: 0 });

    // Ctrl+Shift+Z is the spelling both systems answer to, and the Mac sends with
    // the key between the fingers instead of Ctrl.
    const redone = key('z', { ctrl: true, shift: true });
    await settle();
    expect(redone).toBe(false);
    expect(h.pos(h.object(a)!)).toEqual({ x: 120, y: 60 });

    expect(key('z', { meta: true })).toBe(false);
    await settle();
    expect(h.pos(h.object(a)!)).toEqual({ x: 0, y: 0 });
  });

  // The symptom this guards is a button that lies: an inverse aimed at a note some
  // colleague deleted performs nothing, yjs announces nothing, and the step it was
  // offered by is consumed in the attempt. The keystroke route is the one under test
  // because it is the route with no answer to read - the button has to be told.
  it('greys the control once the step it offered has nowhere left to land', async () => {
    const h = renderBoard7();
    const [theirs] = notesArrivingFromElsewhere(h.doc(), [{ x: 0, y: 0 }, { x: 400, y: 0 }]);
    await settle();
    expect(isDisabled('Undo')).toBe(true);

    h.drag(h.object(theirs)!, { x: 50, y: 50 }, { x: 170, y: 110 });
    await settle();
    expect(h.pos(h.object(theirs)!)).toEqual({ x: 120, y: 60 });
    expect(isDisabled('Undo')).toBe(false);

    // Somewhere else, somebody deletes that very note.
    deleteFromElsewhere(h.doc(), theirs);
    await settle();
    expect(h.notes()).toHaveLength(1);
    // This tab still has its own step in front of it, delete or no delete.
    expect(isDisabled('Undo')).toBe(false);

    key('z', { ctrl: true });
    await settle();

    // The board does not move, and the control goes grey with the history it was
    // reading: there is nothing left for this tab to take back.
    expect(h.notes()).toHaveLength(1);
    expect(isDisabled('Undo')).toBe(true);
    expect(isDisabled('Redo')).toBe(true);
  });

  // TC-20: on a board this person may not edit, the keys are left alone. The
  // history in front of them really does hold a step of this tab's own - the keys
  // are gated by whether this person may write at all, not by what the history
  // happens to remember, and what the board says here is that none of it is theirs
  // to take back.
  it('TC-20 leaves the keys alone where the board may not be edited', () => {
    const doc = new Y.Doc();
    const controller = createUndo(doc);
    const a = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();
    moveObjects(doc, new Map([[a, { x: 220, y: 160 }]]));
    controller.boundary();

    renderKeys({ doc, controller, canEdit: false });
    // A step of this tab's own is standing there, and is not offered.
    expect(controller.canUndo()).toBe(true);

    expect(key('z', { ctrl: true })).toBe(true);
    expect(key('y', { ctrl: true })).toBe(true);
    expect(key('z', { meta: true, shift: true })).toBe(true);

    // Nothing moved, and the step is still where it was: the keys were refused,
    // not consumed.
    expect(where(doc, a)).toEqual({ x: 220, y: 160 });
    expect(controller.canUndo()).toBe(true);
    expect(controller.canRedo()).toBe(false);

    // The same keys, and the same history that is still remembering the move, with
    // the board open for editing: taken, answered, and the move goes back.
    cleanup();
    renderKeys({ doc, controller, canEdit: true });
    expect(key('z', { ctrl: true })).toBe(false);
    expect(where(doc, a)).toEqual({ x: 0, y: 0 });
    controller.destroy();
  });

  // TC-21: the caret is in a text field that is not a note, so the keys belong to
  // the browser and to that field - its own undo history, which the board has no
  // business in. The board does not take them, and the note the person moved an
  // instant ago stays exactly where it is.
  it('TC-21 leaves the keys to a text field that is not a note', async () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    await settle();

    h.press(h.object(a)!, 50, 50);
    h.release(h.object(a)!, 50, 50);
    h.drag(h.object(a)!, { x: 50, y: 50 }, { x: 170, y: 110 });
    await settle();
    expect(h.pos(h.object(a)!)).toEqual({ x: 120, y: 60 });

    const field = foreignField();
    expect(document.activeElement).toBe(field);

    const untouched = fireEvent.keyDown(field, {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await settle();
    expect(untouched).toBe(true);
    expect(h.pos(h.object(a)!)).toEqual({ x: 120, y: 60 });

    // Shift makes no difference, and neither does the spelling a Mac sends.
    for (const keys of [
      { key: 'z', ctrlKey: true, shiftKey: true },
      { key: 'z', metaKey: true },
    ]) {
      expect(fireEvent.keyDown(field, { ...keys, bubbles: true, cancelable: true })).toBe(true);
    }
    await settle();
    expect(h.pos(h.object(a)!)).toEqual({ x: 120, y: 60 });
    // And the history is still where it was: the keys were refused, not lost.
    expect(isDisabled('Undo')).toBe(false);
  });

  // The keys reach the history from anywhere on the board, not only from the board
  // element itself: a note and the canvas behind it both get through.
  it('takes the keys from a note and from the canvas behind it', async () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    await settle();

    h.press(h.object(a)!, 50, 50);
    h.release(h.object(a)!, 50, 50);
    h.drag(h.object(a)!, { x: 50, y: 50 }, { x: 150, y: 50 });
    await settle();

    // From the note itself.
    expect(
      fireEvent.keyDown(h.object(a)!, { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    ).toBe(false);
    await settle();
    expect(h.pos(h.object(a)!)).toEqual({ x: 0, y: 0 });

    // And from the canvas, once there is something to undo again.
    h.press(h.object(a)!, 50, 50);
    h.release(h.object(a)!, 50, 50);
    h.drag(h.object(a)!, { x: 50, y: 50 }, { x: 150, y: 50 });
    await settle();
    expect(key('z', { ctrl: true })).toBe(false);
    await settle();
    expect(h.pos(h.object(a)!)).toEqual({ x: 0, y: 0 });
  });
});

// --- the controls on their own ------------------------------------------------

interface FakeHistory {
  canUndo: boolean;
  canRedo: boolean;
  undo?: () => void;
  redo?: () => void;
}

/** The real toolbar with a history handed to it, so the two controls can be looked
 * at on their own - the states a live board cannot be put into on demand. */
function renderToolbar(history: FakeHistory): void {
  render(
    <Toolbar
      onCreateSticky={vi.fn()}
      undo={{
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        undo: history.undo ?? vi.fn(),
        redo: history.redo ?? vi.fn(),
      }}
    />,
  );
}

/**
 * The board's key handler on its own, with the screen it is to answer to. Nothing
 * is drawn: what is being looked at here is which keystrokes are taken and which
 * are left, and what either does to the history behind them.
 */
function renderKeys(props: { doc: Y.Doc; controller: UndoController; canEdit: boolean }): void {
  function Host(): null {
    const snapshot = objectsSnapshot(props.doc);
    const selection = useSelection(snapshot);
    useBoardKeys({
      doc: props.doc,
      selection,
      snapshot,
      canEdit: props.canEdit,
      undo: props.controller,
    });
    return null;
  }
  render(<Host />);
}

/** Where the object stands in the board, read from the model. */
function where(doc: Y.Doc, id: string): { x: number; y: number } {
  const map = objectsMapOf(doc).get(id);
  if (!map) throw new Error('the object is not on the board at all');
  return { x: map.get('x') as number, y: map.get('y') as number };
}
