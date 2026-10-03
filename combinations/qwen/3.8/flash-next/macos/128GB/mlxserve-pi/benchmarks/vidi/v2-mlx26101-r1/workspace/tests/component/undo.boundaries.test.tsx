// undo.boundaries — gestures and typing form meaningful steps (ui-component).
//
// These mount the real board (with its real undo controller attached in an effect)
// and drive real gestures / typing, then undo through the real keyboard path and
// assert the resulting document. A whole drag (many per-frame writes) must be ONE
// undo step because the gesture opens and closes an undo boundary; a typing burst
// must be ONE step (capture window + a boundary at edit start) and must stay
// separate from an earlier move and from another note's edit. undo.boundaries.

import { describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import {
  boardDoc,
  clickByRole,
  clickNote,
  createNote,
  doubleClick,
  inputInto,
  noteBounds,
  noteEl,
  pointer,
  renderBoard,
  shiftClickNote,
  textEl,
  windowKey,
} from './helpers';
import { getStickyText, objectBounds, snapshot } from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';

/** Select A and B, then press A and drag the whole selection by (dx, dy). */
function selectTwoDrag(a: string, b: string, dx: number, dy: number): void {
  clickNote(a); // selects a
  shiftClickNote(b); // adds b to the selection
  pointer(noteEl(a), 'pointerdown', 0, 0); // a already selected → whole selection moves
  pointer(noteEl(a), 'pointermove', dx, dy);
  pointer(noteEl(a), 'pointerup', dx, dy);
}

/**
 * Dispatch a cancellable keydown on a specific element (bubbles to the React root,
 * where the editor's onKeyDown reads it). Used for Ctrl/Cmd+Z *inside* a note.
 */
function keyIn(
  el: HTMLElement,
  key: string,
  mods: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    shiftKey: mods.shiftKey ?? false,
  });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

const text = (id: string): string =>
  getStickyText(boardDoc(), id)?.toString() ?? '';
const color = (id: string): StickyColor =>
  (snapshot(boardDoc()).find((s) => s.id === id) as { color: StickyColor }).color;

describe('undo.boundaries (ui-component)', () => {
  // TC-14: a whole drag is one step — one undo returns BOTH dragged notes.
  it('TC-14 reverses a whole two-note drag with one undo', () => {
    renderBoard();
    const a = createNote(200, 200);
    const b = createNote(700, 200);
    const before = { a: noteBounds(a), b: noteBounds(b) };

    selectTwoDrag(a, b, 300, 250);

    // Both moved.
    expect(noteBounds(a).x).toBeGreaterThan(before.a.x);
    expect(noteBounds(b).x).toBeGreaterThan(before.b.x);

    // One undo (board owns the keyboard) reverses the WHOLE gesture.
    windowKey('z', { ctrlKey: true });

    expect(noteBounds(a)).toEqual(before.a);
    expect(noteBounds(b)).toEqual(before.b);
  });

  // TC-15: a completed move followed by a colour change 200 ms later are TWO
  // separate steps — the boundary at the gesture end keeps them apart. So the
  // first undo only reverts the colour; the second undo reverts the move.
  it('TC-15 keeps a move and a later colour change as two separate steps', () => {
    vi.useFakeTimers();
    try {
      renderBoard();
      const a = createNote(200, 200);
      const before = noteBounds(a);

      // One move gesture (its own step).
      pointer(noteEl(a), 'pointerdown', 0, 0);
      pointer(noteEl(a), 'pointermove', 400, 0);
      pointer(noteEl(a), 'pointerup', 400, 0);
      const moved = noteBounds(a);
      expect(moved.x).toBeGreaterThan(before.x);
      expect(color(a)).toBe('yellow');

      // 200 ms later — inside the 500 ms capture window — recolour the note.
      vi.advanceTimersByTime(200);
      clickByRole('Green colour');
      expect(color(a)).toBe('green');

      // First undo: colour reverts, the note stays at the moved position.
      windowKey('z', { ctrlKey: true });
      expect(color(a)).toBe('yellow');
      expect(objectBounds(snapshot(boardDoc()).find((s) => s.id === a)!)).toEqual(moved);

      // Second undo: the move itself reverts.
      windowKey('z', { ctrlKey: true });
      expect(noteBounds(a)).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });

  // TC-16: Ctrl+Z inside the editor undoes typing, not the note's earlier move.
  it('TC-16 Ctrl+Z in the editor undoes typing and leaves an earlier move', () => {
    renderBoard();
    const a = createNote(200, 200);
    const created = noteBounds(a);

    // Move it (one gesture step), then leave it where it landed.
    pointer(noteEl(a), 'pointerdown', 0, 0);
    pointer(noteEl(a), 'pointermove', 400, 0);
    pointer(noteEl(a), 'pointerup', 400, 0);
    const moved = noteBounds(a);
    expect(moved.x).toBeGreaterThan(created.x);

    // Open the note and type a burst.
    doubleClick(noteEl(a), 50, 50);
    inputInto(textEl(a), 'hello');
    expect(text(a)).toBe('hello');

    // Ctrl+Z inside the editor: undoes the typing only, the move stays.
    const ev = keyIn(textEl(a), 'z', { ctrlKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(text(a)).toBe('');
    expect(noteBounds(a).x).toBe(moved.x); // still at the moved position
  });

  // TC-17: a drag that is cancelled part-way is still ONE step; one undo restores
  // the note's start position.
  it('TC-17 treats a cancelled drag as one undo step', () => {
    renderBoard();
    const a = createNote(200, 200);
    const before = noteBounds(a);

    // Drag a few frames, then cancel instead of releasing.
    pointer(noteEl(a), 'pointerdown', 0, 0);
    pointer(noteEl(a), 'pointermove', 300, 0);
    pointer(noteEl(a), 'pointercancel', 300, 0);

    expect(noteBounds(a).x).toBeGreaterThan(before.x);

    // The partial drag is one step: one undo restores the start position.
    windowKey('z', { ctrlKey: true });
    expect(noteBounds(a)).toEqual(before);
  });
});
