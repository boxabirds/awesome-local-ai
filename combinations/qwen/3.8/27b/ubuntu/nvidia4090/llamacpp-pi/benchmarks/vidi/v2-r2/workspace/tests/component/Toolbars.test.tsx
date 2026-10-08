import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { renderStickyBoard } from './harness';

afterEach(() => {
  vi.useRealTimers();
});

function selectOnlyNote(utils: ReturnType<typeof renderStickyBoard>): void {
  const note = utils.getByTestId('sticky-note');
  fireEvent.pointerDown(note, { clientX: 640, clientY: 400, pointerId: 1 });
  fireEvent.pointerUp(note, { clientX: 640, clientY: 400, pointerId: 1 });
}

describe('ui-component: toolbars (Toolbar, NoteToolbar)', () => {
  it('TC-27: clicking the pink swatch recolours the note and keeps it selected', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    let id = '';
    act(() => {
      id = createSticky(utils.doc, { x: 0, y: 0 });
    });
    selectOnlyNote(utils);

    const swatch = utils.getByTestId('note-swatch-pink');
    expect(swatch.getAttribute('aria-label')).toBe('Pink colour');
    expect(swatch.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(swatch);

    const note = snapshot(utils.doc).find((o) => o.id === id)!;
    expect(note.color).toBe('pink');
    expect(utils.getByTestId('sticky-note').getAttribute('data-selected')).toBe('true');
    expect(utils.getByTestId('note-swatch-pink').getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-28: the Sticky note button creates one note centred on the viewport and starts editing it', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();

    fireEvent.click(utils.getByTestId('sticky-note-button'));

    const all = snapshot(utils.doc);
    expect(all).toHaveLength(1);
    // Viewport centre (640,400) at zoom 1 is world (0,0); top-left is (-100,-100).
    expect(all[0].x).toBe(-100);
    expect(all[0].y).toBe(-100);
    expect(all[0].color).toBe('yellow');
    // The new note starts editing immediately.
    expect(utils.getByTestId('sticky-textarea')).toBeTruthy();
  });

  it('TC-29: the bin button deletes the note and clears the selection', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    act(() => {
      createSticky(utils.doc, { x: 0, y: 0 });
    });
    selectOnlyNote(utils);

    fireEvent.click(utils.getByTestId('note-delete-button'));

    expect(snapshot(utils.doc)).toHaveLength(0);
    expect(utils.queryByTestId('sticky-note')).toBeNull();
    expect(utils.queryByTestId('note-toolbar')).toBeNull();
  });
});
