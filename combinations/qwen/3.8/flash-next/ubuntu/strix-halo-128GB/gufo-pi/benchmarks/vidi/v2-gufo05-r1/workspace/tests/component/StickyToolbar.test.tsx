/**
 * The toolbars (spec anchor `sticky.toolbar`) — creating a note from the left
 * toolbar, recolouring and deleting from the note toolbar.
 *
 * TC-27 click the Pink swatch      → model colour pink, note still selected
 * TC-28 click the Sticky note tool → one note centred on the view, already editing
 * TC-29 click the bin button       → note removed, selection cleared
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import { snapshot } from '../../src/shared/board-model';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  advanceFrames,
  renderStickyApp,
  viewportCentre,
  worldAt,
  type StickyAppHandle,
} from './stickyHarness';

let board!: StickyAppHandle;

beforeEach(async () => {
  board = await renderStickyApp();
});

async function selectNote(): Promise<string> {
  const id = await board.addNote();
  await board.press(board.note(), 100, 100);
  await board.release(100, 100);
  return id;
}

describe('sticky.toolbar: create', () => {
  it('TC-28 creates a note in the middle of the view and starts typing it', async () => {
    expect(board.noteIds()).toEqual([]);

    await act_click(screen.getByTestId('tool-sticky-note'));

    const notes = board.notes();
    expect(notes).toHaveLength(1);
    const centre = worldAt(board, viewportCentre());
    expect(notes[0]!.x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 5);
    expect(notes[0]!.y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 5);
    expect(notes[0]!.color).toBe('yellow');
    expect(notes[0]!.z).toBe(1);

    // It is selected and editable straight away.
    expect(board.note().dataset.selected).toBe('true');
    expect(screen.getByTestId('sticky-note-editor')).toBeTruthy();
    await board.type('first idea');
    expect(board.notes()[0]!.text).toBe('first idea');
  });

  it('creates the next note above the others in the stacking order', async () => {
    await act_click(screen.getByTestId('tool-sticky-note'));
    await board.pressKey('Escape', board.textarea());
    await act_click(screen.getByTestId('tool-sticky-note'));

    const notes = snapshot(board.doc);
    expect(notes).toHaveLength(2);
    expect(notes[1]!.z).toBeGreaterThan(notes[0]!.z);
  });

  it('creates a note in the middle of the view after the board has been panned', async () => {
    await board.setCamera({ x: -5000, y: 3000, zoom: 1 });

    await act_click(screen.getByTestId('tool-sticky-note'));

    const centre = worldAt(board, viewportCentre());
    const note = board.notes()[0]!;
    expect(note.x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 5);
    expect(note.y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 5);
    // The point the user is looking at, not somewhere near the world origin.
    expect(note.x).toBeCloseTo(-5000 + window.innerWidth / 2 - STICKY_SIZE_WORLD / 2, 5);
  });
});

describe('sticky.toolbar: colour and delete', () => {
  it('TC-27 recolours the selected note with the pink swatch and keeps it selected', async () => {
    const id = await selectNote();

    await act_click(screen.getByRole('button', { name: 'Pink colour' }));

    const note = snapshot(board.doc).find((item) => item.id === id)!;
    expect(note.color).toBe('pink');
    expect(board.note().dataset.selected).toBe('true');
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    // Text and position are untouched.
    expect(note.x).toBeCloseTo(300, 5);
    expect(note.y).toBeCloseTo(200, 5);
    // The swatch states describe themselves, not only by colour.
    expect(screen.getByRole('button', { name: 'Pink colour' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(
      screen.getByRole('button', { name: 'Yellow colour' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('shows all six colours, named, and keeps the note selected when they are clicked', async () => {
    await selectNote();

    const names = Object.keys(STICKY_COLORS);
    expect(names).toHaveLength(6);
    for (const name of names) {
      expect(screen.getByRole('button', { name: `${label(name)} colour` })).toBeTruthy();
    }

    await act_click(screen.getByRole('button', { name: 'Violet colour' }));
    expect(board.notes()[0]!.color).toBe('violet');
    expect(board.note().dataset.selected).toBe('true');
  });

  it('TC-29 deletes the selected note with the bin button and clears the selection', async () => {
    const id = await selectNote();

    await act_click(screen.getByRole('button', { name: 'Delete note' }));

    expect(board.noteIds()).toEqual([]);
    expect(board.noteIds().includes(id)).toBe(false);
    expect(screen.queryAllByTestId('note-toolbar')).toHaveLength(0);
    // The board itself is still there and usable.
    expect(screen.getByTestId('board-viewport')).toBeTruthy();
  });

  it('does not clear the selection when a toolbar button is clicked', async () => {
    await selectNote();

    // A click on the toolbar must not reach the viewport, which would deselect.
    await act_click(screen.getByRole('button', { name: 'Blue colour' }));

    expect(board.note().dataset.selected).toBe('true');
    expect(board.notes()[0]!.color).toBe('blue');
  });
});

/** Click a control and let the board render what it did. */
async function act_click(button: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(button);
  });
  await advanceFrames();
}

function label(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
