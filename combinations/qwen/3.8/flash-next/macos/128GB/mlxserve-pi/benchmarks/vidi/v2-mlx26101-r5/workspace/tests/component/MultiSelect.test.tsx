/**
 * Component tests for a selection that holds more than one object (design capability
 * `sel.interaction`, TC-16 to TC-19): the bar that says how many things are selected, the pruning
 * that keeps a selection honest when objects go away on their own, and the press on empty board
 * space that empties it.
 *
 * The rules being tested are the PRD's, and they are all about the *selection* rather than about any
 * one object: a selection that keeps an object nobody can see, or that counts itself wrong, or that
 * survives a press on the empty board, is the way this feature fails in real use.
 *
 * As in the story 2 tests, jsdom has no layout: positions come from the `data-*` attributes the board
 * renders from the document, and the screen is where the camera says it is.
 */

import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { deleteObject, deleteObjects } from '../../src/shared/board-model';
import { act, board, nextFrame, pointer, renderBoard, type BoardFixture } from './harness';

/** Selects a list of objects the way a keyboard-and-mouse user does: one press, then Shift presses. */
async function selectAllOf(fx: BoardFixture, ids: readonly string[]): Promise<void> {
  const [first, ...rest] = ids;
  if (first === undefined) return;
  await fx.press(first);
  for (const id of rest) await fx.shiftClick(id);
}

/** Deletes objects from the document without asking the board, as another client would. */
async function deleteRemotely(fx: BoardFixture, ids: readonly string[]): Promise<void> {
  await act(async () => {
    deleteObjects(fx.doc(), ids);
    await nextFrame();
  });
}

describe('the selection bar', () => {
  it('TC-17 counts the selection out loud and offers one delete for all of it', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    const b = await fx.create(400, 0);
    await selectAllOf(fx, [a, b]);

    const bar = fx.barEl();
    expect(bar).not.toBeNull();
    expect(fx.barText()).toBe('2 selected');

    const count = screen.getByTestId('selection-count');
    // A count that changes when a colleague deletes one of the four has to be announced: this is the
    // only place a person who cannot see the board learns how big their selection is.
    expect(count.getAttribute('aria-live')).toBe('polite');
    expect(count.getAttribute('role')).toBe('status');

    const button = fx.barDelete();
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('Delete selection');
  });

  it('TC-17 counts the objects that are there, and says so the moment one of them goes', async () => {
    const fx = renderBoard();
    const ids = [await fx.create(0, 0), await fx.create(400, 0), await fx.create(800, 0)];
    await selectAllOf(fx, ids);
    expect(fx.barText()).toBe('3 selected');
    expect(fx.selection().size).toBe(3);

    // A delete by somebody else: the selection loses that object on its own, and the count follows.
    await deleteRemotely(fx, [ids[1] as string]);
    expect(fx.barText()).toBe('2 selected');
    expect(fx.selection().ids.has(ids[1] as string)).toBe(false);
  });

  it('TC-17 deletes the whole selection in one go, and leaves nothing selected', async () => {
    const fx = renderBoard();
    const ids = [await fx.create(0, 0), await fx.create(400, 0), await fx.create(800, 0)];
    await selectAllOf(fx, ids);

    const button = fx.barDelete();
    if (!button) throw new Error('the bar has no delete button');
    fireEvent.click(button);
    await act(nextFrame);

    expect(fx.objects()).toHaveLength(0);
    expect(fx.selection().size).toBe(0);
    expect(fx.barEl()).toBeNull();
  });

  it('TC-18 leaves a selection of one to the note itself, toolbar and all', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    await fx.press(a);

    // One note: the tools that belong to a note are on the note, and a bar that said "1 selected"
    // would be a bar about nothing.
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
    expect(fx.barEl()).toBeNull();
    expect(fx.barText()).toBeNull();
  });

  it('TC-18 trades the note toolbar for the bar as soon as there are two', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    const b = await fx.create(400, 0);
    await fx.press(a);
    expect(screen.queryByTestId('note-toolbar')).not.toBeNull();

    await fx.shiftClick(b);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    expect(fx.barText()).toBe('2 selected');

    // …and back again when the second one is Shift-clicked out of it: one object is selected, so
    // the object's own toolbar is the interface again.
    await fx.shiftClick(b);
    expect(fx.barEl()).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).not.toBeNull();
    expect(fx.selection().size).toBe(1);
    expect(fx.selection().selectedId).toBe(a);
  });

  it('TC-18 puts the per-note outline on every selected object and the box around all of them', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    const b = await fx.create(400, 300);
    await selectAllOf(fx, [a, b]);

    expect(fx.noteBox(a).selected).toBe(true);
    expect(fx.noteBox(b).selected).toBe(true);

    // One box, in world units, holding both notes: (−100,−100)→(500,400).
    const overlay = fx.overlayEl();
    expect(overlay).not.toBeNull();
    expect({
      x: Number(overlay?.dataset['x']),
      y: Number(overlay?.dataset['y']),
      width: Number(overlay?.dataset['width']),
      height: Number(overlay?.dataset['height']),
    }).toEqual({ x: -100, y: -100, width: 600, height: 500 });
  });
});

describe('a selection that loses objects on its own', () => {
  it('TC-16 empties itself when the whole selection is deleted elsewhere', async () => {
    const fx = renderBoard();
    const ids = [await fx.create(0, 0), await fx.create(400, 0)];
    await selectAllOf(fx, ids);
    expect(fx.selection().size).toBe(2);

    await deleteRemotely(fx, ids);

    expect(fx.selection().size).toBe(0);
    expect(fx.selection().selectedId).toBeNull();
    expect(fx.barEl()).toBeNull();
    expect(fx.overlayEl()).toBeNull();
    expect(fx.handles()).toHaveLength(0);
  });

  it('TC-16 stops editing an object that was deleted while it was being typed into', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    await fx.press(a);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' });
      await nextFrame();
    });
    expect(fx.selection().editingId).toBe(a);

    await deleteRemotely(fx, [a]);

    expect(fx.selection().editingId).toBeNull();
    expect(fx.noteEl(a)).toBeNull();
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
  });

  it('TC-16 lets go of an object that is gone rather than keeping it in the count', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    const b = await fx.create(400, 0);
    const c = await fx.create(800, 0);
    await selectAllOf(fx, [a, b, c]);

    await act(async () => {
      deleteObject(fx.doc(), b);
      await nextFrame();
    });

    // The selection is what is on the board, so an id the document no longer has cannot be in it —
    // and cannot be counted, moved or deleted by the next gesture.
    expect([...fx.selection().ids].sort()).toEqual([a, c].sort());
    expect(fx.barText()).toBe('2 selected');
  });
});

describe('clearing the selection', () => {
  it('TC-19 empties the selection on a press in empty space, without a drag or a release', async () => {
    const fx = renderBoard();
    const ids = [await fx.create(0, 0), await fx.create(400, 0), await fx.create(800, 0)];
    await selectAllOf(fx, ids);

    // The press is the meaning; the release is only the proof. In jsdom this pointer never comes
    // back, and the selection is empty already.
    pointer('pointerDown', board(), { x: 40, y: 40, pointerId: 9 });
    await act(nextFrame);

    expect(fx.selection().size).toBe(0);
    expect(fx.barEl()).toBeNull();
    expect(fx.overlayEl()).toBeNull();
  });

  it('TC-19 does not clear the selection when the press lands on an object that is in it', async () => {
    // This is the press that drags the group: a board that dropped the other two here would make a
    // selection of three impossible to move.
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    const b = await fx.create(400, 0);
    await selectAllOf(fx, [a, b]);

    await fx.press(b);

    expect(fx.selection().size).toBe(2);
    expect(fx.barText()).toBe('2 selected');
  });

  it('TC-19 replaces the selection when the press lands on an object outside it', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    const b = await fx.create(400, 0);
    const c = await fx.create(800, 0);
    await selectAllOf(fx, [a, b]);

    await fx.press(c);

    expect(fx.selection().selectedId).toBe(c);
    expect(fx.barEl()).toBeNull();
  });

  it('TC-19 leaves Escape to the browser when there is nothing selected', async () => {
    const fx = renderBoard();
    await fx.create(0, 0);
    expect(fx.selection().size).toBe(0);

    // Nothing to deselect, so the key is not the board's to take: `fireEvent` answers false once a
    // handler has called preventDefault, and here nobody has. A dialog behind the board may want it.
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(true);
  });

  it('TC-19 takes Escape for itself once there is something to lose', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    await fx.press(a);

    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(false);
    expect(fx.selection().size).toBe(0);
  });
});
