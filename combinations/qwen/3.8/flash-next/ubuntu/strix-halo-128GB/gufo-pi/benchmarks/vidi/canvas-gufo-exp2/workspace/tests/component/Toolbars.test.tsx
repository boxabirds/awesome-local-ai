import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { cameraFromDom } from './helpers/board';
import {
  deleteButton,
  doubleClickBoard,
  noteEl,
  notes,
  pressKey,
  swatch,
} from './helpers/sticky';

/**
 * Story 2 — the toolbars: the fixed left toolbar with the Sticky note button,
 * and the floating toolbar that appears above a selected note.
 */

beforeEach(() => {
  document.documentElement.style.width = '1024px';
  document.documentElement.style.height = '768px';
});

function createNoteAtCentre(): string {
  doubleClickBoard(512, 384);
  return notes()[0].id;
}

describe('the Sticky note tool (TC-28)', () => {
  it('creates one note in the middle of the visible board area and enters edit mode', async () => {
    const user = userEvent.setup();
    render(<App />);
    const camera = cameraFromDom();

    await user.click(screen.getByRole('button', { name: 'Sticky note' }));

    expect(notes()).toHaveLength(1);
    const [note] = notes();
    // Centre of the viewport in world coordinates, and the point is the note's
    // centre rather than its top-left corner.
    const expectedCentre = { x: 512 / camera.zoom + camera.x, y: 384 / camera.zoom + camera.y };
    expect(note.x + STICKY_SIZE_WORLD / 2).toBeCloseTo(expectedCentre.x, 6);
    expect(note.y + STICKY_SIZE_WORLD / 2).toBeCloseTo(expectedCentre.y, 6);
    // The user can type straight away.
    expect(screen.getAllByTestId('sticky-textarea')).toHaveLength(1);
  });

  it('follows the visible area when the board has been panned', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Pan 200 px right and 100 px down by moving the camera.
    window.__vidi6?.setCamera?.(-712, -484, 1);

    await user.click(screen.getByRole('button', { name: 'Sticky note' }));
    const [note] = notes();
    expect(note.x + STICKY_SIZE_WORLD / 2).toBeCloseTo(-200, 6);
    expect(note.y + STICKY_SIZE_WORLD / 2).toBeCloseTo(-100, 6);
  });
});

function hexToRgb(hex: string): string {
  const value = hex.replace('#', '');
  const parts = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return `rgb(${parts.join(', ')})`;
}

describe('the floating toolbar: colour presets (TC-27)', () => {
  it('sets the note colour from a swatch and keeps the note selected', async () => {
    const user = userEvent.setup();
    render(<App />);
    const id = createNoteAtCentre();
    pressKey('Escape');

    expect(notes()[0].color).toBe('yellow');
    await user.click(swatch(noteEl(id), 'Pink'));

    expect(notes()[0].color).toBe('pink');
    expect(notes()[0].text).toBe('');
    expect(noteEl(id).dataset.selected).toBe('true');
    expect(swatch(noteEl(id), 'Pink').getAttribute('aria-pressed')).toBe('true');
    expect(swatch(noteEl(id), 'Yellow').getAttribute('aria-pressed')).toBe('false');
  });

  it('offers exactly the six preset colours, with the current one marked', async () => {
    const user = userEvent.setup();
    render(<App />);
    const id = createNoteAtCentre();
    pressKey('Escape');

    const names = ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet'];
    for (const name of names) {
      expect(swatch(noteEl(id), name)).toBeTruthy();
    }
    expect(noteEl(id).querySelectorAll('.note-swatch')).toHaveLength(6);

    await user.click(swatch(noteEl(id), 'Blue'));
    expect(notes()[0].color).toBe('blue');
    // The note is painted with the preset's colour (jsdom reports rgb()).
    expect(getComputedStyle(noteEl(id)).backgroundColor).toBe(hexToRgb(STICKY_COLORS.blue));
  });

  it('changes colour twice without moving the note', async () => {
    const user = userEvent.setup();
    render(<App />);
    const id = createNoteAtCentre();
    pressKey('Escape');
    const before = notes()[0];

    await user.click(swatch(noteEl(id), 'Green'));
    await user.click(swatch(noteEl(id), 'Orange'));
    expect(notes()[0].color).toBe('orange');
    expect(notes()[0].x).toBeCloseTo(before.x, 6);
    expect(notes()[0].z).toBe(before.z);
  });
});

describe('the floating toolbar: bin (TC-29)', () => {
  it('removes the note from the model and the DOM and clears the selection', async () => {
    const user = userEvent.setup();
    render(<App />);
    const id = createNoteAtCentre();
    pressKey('Escape');
    expect(notes()[0].id).toBe(id);

    await user.click(deleteButton(noteEl(id)));

    expect(notes()).toHaveLength(0);
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
    // The board keeps working: another note can be created and selected.
    await user.click(screen.getByRole('button', { name: 'Sticky note' }));
    expect(notes()).toHaveLength(1);
  });

  it('leaves the other notes alone', async () => {
    const user = userEvent.setup();
    render(<App />);
    doubleClickBoard(300, 300);
    pressKey('Escape');
    doubleClickBoard(700, 500);
    pressKey('Escape');
    expect(notes()).toHaveLength(2);
    const ids = notes().map((n) => n.id);
    const doomed = ids[ids.length - 1]!;
    const kept = ids.find((id) => id !== doomed)!;

    await user.click(deleteButton(noteEl(doomed)));
    expect(notes()).toHaveLength(1);
    expect(notes()[0].id).toBe(kept);
    expect(noteEl(kept).dataset.selected).toBe('false');
  });
});
