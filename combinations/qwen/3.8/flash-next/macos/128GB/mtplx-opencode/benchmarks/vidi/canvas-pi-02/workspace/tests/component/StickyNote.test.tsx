import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { deleteObject } from '../../src/shared/board-model';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { dispatch, pointerEvent } from './harness';
import { renderApp, flush } from './appHarness';

/**
 * TC-18 to TC-22, TC-25, TC-35 to TC-37 - the pointer and keyboard state
 * machine of a sticky note (design "Sticky note interaction").
 *
 * The camera assertions are the point of several of these: a note must never
 * pan the board, and a drag on a note must never create one.
 */

const NOTE_AT = { x: 300, y: 200 };

/** jsdom reports colours as rgb(), so compare in the form it uses. */
function rgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

function firstNote(harness: ReturnType<typeof renderApp>) {
  const id = harness.notes()[0].id;
  return { id, element: harness.noteElement(id) };
}

describe('rendering', () => {
  it('draws a 200x200 group at the note position in its colour', () => {
    const harness = renderApp([{ ...NOTE_AT, color: 'pink' }]);
    const { element } = firstNote(harness);

    expect(element.getAttribute('role')).toBe('group');
    expect(element.getAttribute('aria-label')).toBe('Sticky note');
    expect(element.dataset.boardObject).toBe('sticky');
    expect(element.style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(element.style.height).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(element.style.left).toBe(`${NOTE_AT.x}px`);
    expect(element.style.top).toBe(`${NOTE_AT.y}px`);
    expect(element.style.backgroundColor).toBe(rgb(STICKY_COLORS.pink));
    expect(element.getAttribute('data-selected')).toBe('false');
    // Unselected notes carry no toolbar.
    expect(harness.toolbar()).toBeNull();
  });

  it('renders the text read-only and wraps it inside the note', () => {
    const harness = renderApp([{ ...NOTE_AT, text: 'Faster onboarding' }]);
    const { id } = firstNote(harness);

    expect(harness.noteText(id)).toBe('Faster onboarding');
    expect(harness.editor()).toBeNull();
  });

  it('paints in z order, lowest first, so the top note is last in the DOM', () => {
    const harness = renderApp([
      { ...NOTE_AT },
      { x: 340, y: 220 },
      { x: 380, y: 240 },
    ]);

    const notes = harness.notes();
    expect(notes.map((note) => note.z)).toEqual([1, 2, 3]);
    const elements = harness.noteElements();
    expect(elements.map((element) => element.dataset.noteId)).toEqual(
      notes.map((note) => note.id),
    );
  });
});

describe('select (TC-18, TC-22)', () => {
  it('TC-18 a short press with no movement selects the note and shows its toolbar', async () => {
    const harness = renderApp([NOTE_AT]);
    const { element } = firstNote(harness);

    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(element, pointerEvent('pointerup', { clientX: 400, clientY: 250, buttons: 1 }));

    expect(harness.noteElement(harness.notes()[0].id).getAttribute('data-selected')).toBe(
      'true',
    );
    expect(harness.toolbar()).not.toBeNull();
    // Nothing moved.
    expect(harness.notes()[0]).toMatchObject(NOTE_AT);
  });

  it('TC-22 a click on empty board space clears the selection and the toolbar', async () => {
    const harness = renderApp([NOTE_AT]);
    const { id, element } = firstNote(harness);
    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(element, pointerEvent('pointerup', { clientX: 400, clientY: 250, buttons: 1 }));
    expect(harness.toolbar()).not.toBeNull();

    await dispatch(harness.board(), pointerEvent('pointerdown', { clientX: 60, clientY: 80, buttons: 1 }));
    await dispatch(harness.board(), pointerEvent('pointerup', { clientX: 60, clientY: 80, buttons: 1 }));

    expect(harness.noteElement(id).getAttribute('data-selected')).toBe('false');
    expect(harness.toolbar()).toBeNull();
  });

  it('Tab reaches a note and focusing it selects it', async () => {
    const harness = renderApp([NOTE_AT]);
    const { element } = firstNote(harness);

    expect(element.getAttribute('tabindex')).toBe('0');
    await act(async () => {
      element.focus();
    });

    expect(document.activeElement).toBe(element);
    expect(element.getAttribute('data-selected')).toBe('true');
  });
});

describe('move (TC-19, TC-20, TC-21)', () => {
  it('TC-19 a 2px move stays below the threshold: selected, nothing moved', async () => {
    const harness = renderApp([NOTE_AT]);
    const { element } = firstNote(harness);

    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(element, pointerEvent('pointermove', { clientX: 402, clientY: 250, buttons: 1 }));
    await dispatch(element, pointerEvent('pointerup', { clientX: 402, clientY: 250, buttons: 1 }));

    expect(harness.notes()[0]).toMatchObject(NOTE_AT);
    expect(harness.noteElement(harness.notes()[0].id).getAttribute('data-selected')).toBe(
      'true',
    );
    expect(harness.board().dataset.panning).toBe('false');
  });

  it('TC-19 a 2px move does not pan the board either', async () => {
    const harness = renderApp([NOTE_AT]);
    const before = harness.camera();
    const { element } = firstNote(harness);

    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(element, pointerEvent('pointermove', { clientX: 402, clientY: 250, buttons: 1 }));

    expect(harness.camera()).toEqual(before);
    expect(harness.board().dataset.panning).toBe('false');
  });

  it('TC-20 a 3px move is a drag: the note moves and the camera does not', async () => {
    const harness = renderApp([NOTE_AT]);
    const before = harness.camera();
    const { element } = firstNote(harness);

    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(element, pointerEvent('pointermove', { clientX: 403, clientY: 250, buttons: 1 }));

    // One frame later the position has been written to the document.
    await flush();
    expect(harness.notes()[0].x).toBeCloseTo(NOTE_AT.x + 3, 6);
    expect(harness.camera()).toEqual(before);
    // The toolbar is hidden while dragging.
    expect(harness.toolbar()).toBeNull();

    await dispatch(element, pointerEvent('pointerup', { clientX: 403, clientY: 250, buttons: 1 }));
    expect(harness.noteElement(harness.notes()[0].id).getAttribute('data-selected')).toBe(
      'true',
    );
    expect(harness.toolbar()).not.toBeNull();
  });

  it('TC-20 dragging a note brings it to the top', async () => {
    const harness = renderApp([{ ...NOTE_AT }, { x: 340, y: 220 }]);
    const bottom = harness.notes()[0];
    expect(bottom.z).toBe(1);

    const element = harness.noteElement(bottom.id);
    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(element, pointerEvent('pointermove', { clientX: 410, clientY: 250, buttons: 1 }));
    await flush();

    const notes = harness.notes();
    expect(notes.map((note) => note.z)).toEqual([2, 3]);
    expect(notes.find((note) => note.id === bottom.id)?.z).toBe(3);
    // And it is painted last, which is what puts it on top.
    expect(harness.noteElements().at(-1)?.dataset.noteId).toBe(bottom.id);
  });

  it('TC-21 pointercancel leaves the note where it was last shown', async () => {
    const harness = renderApp([NOTE_AT]);
    const cameraBefore = harness.camera();
    const { element } = firstNote(harness);

    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(element, pointerEvent('pointermove', { clientX: 430, clientY: 250, buttons: 1 }));
    await flush();
    const shown = harness.notes()[0];
    expect(shown.x).toBeCloseTo(NOTE_AT.x + 30, 6);

    await dispatch(element, pointerEvent('pointercancel', { clientX: 460, clientY: 250, buttons: 1 }));
    await flush();

    expect(harness.notes()[0].x).toBeCloseTo(shown.x, 6);
    expect(harness.noteElement(harness.notes()[0].id).getAttribute('data-selected')).toBe(
      'true',
    );
    // Cancelling a note drag never pans the board.
    expect(harness.camera()).toEqual(cameraBefore);
  });

  it('the drag keeps tracking once the pointer is off the note', async () => {
    const harness = renderApp([NOTE_AT]);
    const { element } = firstNote(harness);

    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(element, pointerEvent('pointermove', { clientX: 410, clientY: 250, buttons: 1 }));

    // Far enough that the cursor is no longer over the 200-pixel note, and
    // dispatched on the window: this is what a real browser reports once the
    // pointer has slipped off the element, or onto the note underneath.
    await dispatch(window, pointerEvent('pointermove', { clientX: 700, clientY: 400, buttons: 1 }));
    await flush();
    expect(harness.notes()[0].x).toBeCloseTo(NOTE_AT.x + 300, 6);

    await dispatch(window, pointerEvent('pointerup', { clientX: 700, clientY: 400, buttons: 1 }));
    expect(harness.notes()[0]).toMatchObject({ x: NOTE_AT.x + 300 });
  });

  it('a release the browser never reported stops the drag', async () => {
    // The button was let go outside the window, so no pointerup arrives. The
    // next move says it is not held, and the note must not follow an unheld
    // pointer across the board.
    const harness = renderApp([NOTE_AT]);
    const { element } = firstNote(harness);

    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(element, pointerEvent('pointermove', { clientX: 430, clientY: 250, buttons: 1 }));
    await flush();
    const shown = harness.notes()[0];
    expect(shown.x).toBeCloseTo(NOTE_AT.x + 30, 6);

    await dispatch(window, pointerEvent('pointermove', { clientX: 900, clientY: 600 }));
    await dispatch(window, pointerEvent('pointermove', { clientX: 950, clientY: 620 }));
    await flush();

    expect(harness.notes()[0].x).toBeCloseTo(shown.x, 6);
    expect(harness.noteElement(harness.notes()[0].id).dataset.selected).toBe('false');
    expect(harness.board().dataset.panning).toBe('false');
  });

  it('drag at 200% converts screen pixels into half as many world units', async () => {
    const harness = renderApp([NOTE_AT]);

    // The same test-only hook the e2e suite uses, present because Vitest runs
    // in mode "test".
    await act(async () => {
      window.__vidi6?.setCamera({ x: -300, y: -200, zoom: 2 });
    });
    await flush();
    expect(harness.camera()).toEqual({ x: -300, y: -200, zoom: 2 });

    const { element } = firstNote(harness);
    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(element, pointerEvent('pointermove', { clientX: 440, clientY: 250, buttons: 1 }));
    await flush();

    // 40 screen px at 200% is 20 world units, so the grabbed point stays
    // under the pointer.
    expect(harness.notes()[0].x).toBeCloseTo(NOTE_AT.x + 20, 6);
  });
});

describe('keyboard (TC-25, TC-35, TC-36, TC-37)', () => {
  it.each(['Delete', 'Backspace'])(
    'TC-25 %s on a selected note deletes it and clears the selection',
    async (key) => {
      const harness = renderApp([NOTE_AT]);
      const { element } = firstNote(harness);
      await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
      await dispatch(element, pointerEvent('pointerup', { clientX: 400, clientY: 250, buttons: 1 }));
      expect(harness.notes()).toHaveLength(1);

      await dispatch(
        element,
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );

      expect(harness.notes()).toHaveLength(0);
      expect(harness.noteElements()).toHaveLength(0);
      expect(harness.toolbar()).toBeNull();
    },
  );

  it('TC-36 Enter with nothing selected does nothing', async () => {
    const harness = renderApp();

    await dispatch(
      document.body,
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    expect(harness.notes()).toHaveLength(0);
    expect(harness.editor()).toBeNull();
  });

  it('a key while focus is in a text field never deletes the note', async () => {
    const harness = renderApp([{ ...NOTE_AT, text: 'keep me' }]);
    const { element } = firstNote(harness);
    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(element, pointerEvent('pointerup', { clientX: 400, clientY: 250, buttons: 1 }));

    const input = document.createElement('input');
    document.body.appendChild(input);
    await dispatch(
      input,
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }),
    );

    expect(harness.notes()).toHaveLength(1);
    input.remove();
  });

  it('TC-35 double-clicking a note edits it and does not create another one', async () => {
    const harness = renderApp([{ ...NOTE_AT, text: 'edit me' }]);
    const { element } = firstNote(harness);

    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(element, pointerEvent('pointerup', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(
      element,
      new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 400, clientY: 250 }),
    );

    expect(harness.notes()).toHaveLength(1);
    expect(harness.editor()?.value).toBe('edit me');
  });

  it('a double-click on a note never reaches the viewport', async () => {
    const harness = renderApp([NOTE_AT]);
    const { element } = firstNote(harness);

    await dispatch(
      element,
      new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 400, clientY: 250 }),
    );

    expect(harness.notes()).toHaveLength(1);
  });

  it('TC-37 a note deleted while dragging ends the drag without a fuss', async () => {
    const harness = renderApp([NOTE_AT]);
    const { id, element } = firstNote(harness);

    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(element, pointerEvent('pointermove', { clientX: 420, clientY: 250, buttons: 1 }));
    await flush();

    await act(async () => {
      deleteObject(harness.doc, id);
    });
    await flush();

    // The pointer keeps moving and is released; nothing throws and nothing is
    // put back into the document.
    await dispatch(element, pointerEvent('pointermove', { clientX: 440, clientY: 260, buttons: 1 }));
    await dispatch(element, pointerEvent('pointerup', { clientX: 440, clientY: 260, buttons: 1 }));

    expect(harness.notes()).toHaveLength(0);
    expect(harness.noteElements()).toHaveLength(0);
  });

  it('TC-37 a note deleted while being edited closes the editor', async () => {
    const harness = renderApp([{ ...NOTE_AT, text: 'abc' }]);
    const { id, element } = firstNote(harness);
    await dispatch(element, pointerEvent('pointerdown', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(element, pointerEvent('pointerup', { clientX: 400, clientY: 250, buttons: 1 }));
    await dispatch(document.body, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(harness.editor()).not.toBeNull();

    await act(async () => {
      deleteObject(harness.doc, id);
    });
    await flush();

    expect(harness.editor()).toBeNull();
    expect(harness.notes()).toHaveLength(0);
  });
});
