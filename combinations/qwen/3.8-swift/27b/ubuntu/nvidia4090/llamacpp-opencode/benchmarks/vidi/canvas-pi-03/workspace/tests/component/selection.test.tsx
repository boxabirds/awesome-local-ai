/**
 * Story 7 component tests — sel.interaction (TC-16 to TC-19): multi-selection
 * state, outlines, the "N selected" bar and pruning of remotely deleted ids.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from 'src/client/App';
import { boardReady } from './ready';
import { createSticky, deleteObjects, snapshot } from 'src/shared/board-model';

/**
 * Direct doc mutations (outside the UI event system) are wrapped in act() so
 * the store subscription flushes the re-render before the test queries the DOM.
 */
function makeNotes(positions: Array<{ x: number; y: number; color: 'yellow' | 'orange' | 'green'; text: string }>): string[] {
  const doc = getDoc();
  const ids: string[] = [];
  act(() => {
    for (const p of positions) ids.push(createSticky(doc, { x: p.x, y: p.y }, p.color, p.text)!);
  });
  return ids;
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

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

describe('sel.interaction (component)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('TC-16: all selected ids deleted remotely → selection empty, bar hidden', async () => {
    const doc = getDoc();
    const [a, b] = makeNotes([
      { x: -200, y: -100, color: 'yellow', text: 'a' },
      { x: 100, y: -100, color: 'orange', text: 'b' },
    ]);
    const [noteA, noteB] = screen.getAllByTestId('sticky-note');

    const user = userEvent.setup();
    await user.click(noteA);
    await shiftClick(user, noteB);

    // Two selected → the bar is visible.
    expect(noteA.hasAttribute('data-selected')).toBe(true);
    expect(noteB.hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId('selection-bar')).toBeTruthy();

    // A colleague deletes both selected notes (remote delete).
    act(() => {
      deleteObjects(doc, [a, b]);
    });

    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(0);
    // The selection was pruned: bar hidden, nothing selected.
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('TC-17: two selected → "2 selected" + Delete selection button; aria-live announces count', async () => {
    makeNotes([
      { x: -200, y: -100, color: 'yellow', text: 'a' },
      { x: 100, y: -100, color: 'orange', text: 'b' },
    ]);
    const [noteA, noteB] = screen.getAllByTestId('sticky-note');

    const user = userEvent.setup();
    await user.click(noteA);
    // One note only → no bar yet (the note toolbar shows instead).
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    await shiftClick(user, noteB);

    const bar = screen.getByTestId('selection-bar');
    const count = screen.getByTestId('selection-count');
    expect(count).toHaveTextContent('2 selected');
    // Announced to assistive tech via aria-live.
    expect(count.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeTruthy();
    expect(bar).toBeTruthy();
  });

  it('TC-18: one sticky selected → NoteToolbar instead of bar', async () => {
    makeNotes([{ x: 0, y: 0, color: 'yellow', text: 'a' }]);
    const [note] = screen.getAllByTestId('sticky-note');

    const user = userEvent.setup();
    await user.click(note);

    expect(note.hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('TC-19: empty-space click without drag → selection cleared', async () => {
    makeNotes([
      { x: -200, y: -100, color: 'yellow', text: 'a' },
      { x: 100, y: -100, color: 'orange', text: 'b' },
    ]);
    const [noteA, noteB] = screen.getAllByTestId('sticky-note');

    const user = userEvent.setup();
    await user.click(noteA);
    await shiftClick(user, noteB);
    expect(screen.getByTestId('selection-bar')).toBeTruthy();

    // Click empty board space (jsdom rects are 0×0, so this hits the viewport
    // element itself — the empty-space path, away from the notes).
    await user.click(screen.getByTestId('board-viewport'));

    expect(noteA.hasAttribute('data-selected')).toBe(false);
    expect(noteB.hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});
