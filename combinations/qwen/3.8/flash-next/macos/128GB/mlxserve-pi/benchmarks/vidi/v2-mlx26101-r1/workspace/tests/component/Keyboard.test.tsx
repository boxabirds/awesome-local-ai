// Keyboard support for selection (sel.keyboard, ui-component).
//
// Ctrl/Cmd+A selects every object, Delete/Backspace removes the selection, arrows
// nudge it by one world unit (Shift by ten) without scrolling the page, and Escape
// clears it. A field that has focus owns the keyboard, so text editing is never
// turned into a board command. Enter still opens a single selected note for editing.

import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import {
  clickNote,
  createNote,
  modelSnapshot,
  noteBounds,
  renderBoard,
  textEl,
} from './helpers';

interface Mods {
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

/** Dispatch a cancellable keydown and report whether the handler prevented it. */
function key(target: EventTarget, k: string, mods: Mods = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    key: k,
    bubbles: true,
    cancelable: true,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    shiftKey: mods.shiftKey ?? false,
  });
  act(() => {
    (target as Element | Window).dispatchEvent(ev);
  });
  return ev;
}

const windowKb = (k: string, mods?: Mods) => key(window, k, mods);

describe('sel.keyboard (ui-component)', () => {
  // TC-27: Ctrl/Cmd+A selects every object and prevents the browser default.
  it('TC-27 selects every object with Ctrl/Cmd+A (preventDefault)', () => {
    renderBoard();
    createNote(0, 0);
    createNote(500, 0);
    createNote(1000, 0);

    const ev = windowKb('a', { ctrlKey: true });

    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByTestId('selection-bar').textContent).toContain('3 selected');
  });

  // TC-28: Ctrl/Cmd+A on an empty board selects nothing and never throws.
  it('TC-28 selects nothing on an empty board', () => {
    renderBoard();

    windowKb('a', { ctrlKey: true });
    windowKb('a', { metaKey: true });

    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(modelSnapshot()).toHaveLength(0);
  });

  // TC-29: arrows nudge by one and by ten (Shift), without scrolling the page.
  it('TC-29 nudges by one step and by the large step with Shift', () => {
    renderBoard();
    const id = createNote(0, 0);
    clickNote(id);
    const start = noteBounds(id);

    const right = windowKb('ArrowRight');
    expect(right.defaultPrevented).toBe(true);
    expect(noteBounds(id).x).toBeCloseTo(start.x + NUDGE_STEP_WORLD, 6);
    expect(noteBounds(id).y).toBeCloseTo(start.y, 6);

    const up = windowKb('ArrowUp', { shiftKey: true });
    expect(up.defaultPrevented).toBe(true);
    expect(noteBounds(id).y).toBeCloseTo(start.y - NUDGE_LARGE_STEP_WORLD, 6);
  });

  // TC-30 (negative): Backspace while editing edits text, never deletes the object.
  it('TC-30 keeps the object while its text editor handles Backspace', () => {
    renderBoard();
    const id = createNote(0, 0);
    clickNote(id);
    windowKb('Enter'); // open the sole note for editing

    const editor = textEl(id) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(editor);

    // Backspace goes to the editor, not the board: the note is not deleted.
    key(editor, 'Backspace');

    expect(modelSnapshot()).toHaveLength(1); // object kept
    expect(screen.getByTestId(`sticky-note-${id}`)).toBeTruthy();
  });

  // TC-31: Delete removes the whole selection and empties it.
  it('TC-31 deletes the entire selection', () => {
    renderBoard();
    createNote(0, 0);
    createNote(500, 0);
    createNote(1000, 0);
    windowKb('a', { ctrlKey: true }); // select all (3)

    windowKb('Delete');

    expect(modelSnapshot()).toHaveLength(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull(); // selection empty
  });
});
