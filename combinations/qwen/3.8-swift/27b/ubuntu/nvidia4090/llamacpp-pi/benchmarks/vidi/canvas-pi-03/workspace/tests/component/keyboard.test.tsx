/**
 * Story 7 component tests — sel.keyboard (TC-27 to TC-31): select all,
 * select-all on an empty board, nudge steps (with preventDefault), Backspace
 * while editing (text only) and Delete with a multi-selection.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from 'src/client/App';
import { boardReady } from './ready';
import { createSticky, snapshot } from 'src/shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from 'src/shared/config';

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

/**
 * Shift+click. user.click does not forward `shiftKey` to pointerdown in this
 * userEvent version, so the key is held via the keyboard first.
 */
async function shiftClick(user: ReturnType<typeof userEvent.setup>, el: HTMLElement) {
  await user.keyboard('{Shift>}');
  await user.click(el);
  await user.keyboard('{/Shift}');
}

/** Direct doc mutations wrapped in act() so the re-render flushes. */
function makeNotes(positions: Array<{ x: number; y: number; color: 'yellow' | 'orange' | 'green'; text: string }>): void {
  const doc = getDoc();
  act(() => {
    for (const p of positions) createSticky(doc, { x: p.x, y: p.y }, p.color, p.text);
  });
}

describe('sel.keyboard (component)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('TC-27: Ctrl/Cmd+A selects all with preventDefault', async () => {
    makeNotes([
      { x: -200, y: -100, color: 'yellow', text: 'a' },
      { x: 100, y: -100, color: 'orange', text: 'b' },
      { x: 0, y: 150, color: 'green', text: 'c' },
    ]);

    // preventDefault: fireEvent returns false when the default was prevented.
    expect(fireEvent.keyDown(window, { key: 'a', ctrlKey: true })).toBe(false);

    const notes = screen.getAllByTestId('sticky-note');
    for (const n of notes) {
      expect(n.hasAttribute('data-selected')).toBe(true);
    }
    expect(screen.getByTestId('selection-count')).toHaveTextContent('3 selected');
  });

  it('TC-28: Ctrl/Cmd+A on empty board → empty, no error (boundary)', () => {
    expect(snapshot(getDoc())).toHaveLength(0);
    expect(() => fireEvent.keyDown(window, { key: 'a', ctrlKey: true })).not.toThrow();
    // Nothing selected: no bar, no outline.
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(0);
  });

  it('TC-29: ArrowRight → x + NUDGE_STEP_WORLD; Shift+ArrowUp → y − NUDGE_LARGE_STEP_WORLD; preventDefault', async () => {
    const doc = getDoc();
    const id = (() => {
      let out = '';
      act(() => {
        out = createSticky(doc, { x: 0, y: 0 }, 'yellow', 'a')!;
      });
      return out;
    })();
    const [note] = screen.getAllByTestId('sticky-note');

    const user = userEvent.setup();
    await user.click(note);

    const start = snapshot(doc).find((o) => o.id === id)!;

    expect(fireEvent.keyDown(window, { key: 'ArrowRight' })).toBe(false);
    let s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(start.x + NUDGE_STEP_WORLD);
    expect(s.y).toBe(start.y);

    expect(fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true })).toBe(false);
    s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(start.x + NUDGE_STEP_WORLD);
    expect(s.y).toBe(start.y - NUDGE_LARGE_STEP_WORLD);
  });

  it('TC-30: Backspace while editing → text edited, objects kept (negative)', async () => {
    const doc = getDoc();
    const viewport = screen.getByTestId('board-viewport');
    // Double-click creates a note in edit mode.
    fireEvent.doubleClick(viewport, { clientX: 0, clientY: 0 });
    const user = userEvent.setup();
    await user.type(screen.getByTestId('sticky-note-textarea'), 'hi');

    // Backspace is consumed by the editor, not the board (no deletion).
    await user.keyboard('{Backspace}');

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('h');
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(1);
  });

  it('TC-31: Delete with selection → all removed, selection empty', async () => {
    const doc = getDoc();
    makeNotes([
      { x: -200, y: -100, color: 'yellow', text: 'a' },
      { x: 100, y: -100, color: 'orange', text: 'b' },
    ]);
    const [noteA, noteB] = screen.getAllByTestId('sticky-note');

    const user = userEvent.setup();
    await user.click(noteA);
    await shiftClick(user, noteB);
    expect(snapshot(doc)).toHaveLength(2);

    expect(fireEvent.keyDown(window, { key: 'Delete' })).toBe(false);

    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});
