import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import App from '../../src/client/App';
import { screenToWorld } from '../../src/client/canvas/camera';
import { snapshot } from '../../src/shared/board-model';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  boardDoc,
  clickByRole,
  clickNote,
  createNote,
  noteCount,
  noteEl,
  noteSelected,
  readCamera,
} from './helpers';

function modelColor(id: string): string {
  return snapshot(boardDoc()).find((n) => n.id === id)?.color ?? '';
}

/** jsdom normalises inline colours to rgb(); compare against that form. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe('sticky.toolbar', () => {
  it('TC-27 choosing the Pink swatch recolours the note and keeps selection', () => {
    render(<App />);
    const id = createNote(300, 300);
    clickNote(id);

    clickByRole('Pink colour');

    expect(modelColor(id)).toBe('pink');
    expect(noteEl(id).style.backgroundColor).toBe(hexToRgb(STICKY_COLORS.pink));
    expect(noteSelected(id)).toBe(true); // selection unchanged
    // The swatch reflects the current colour via aria-pressed, not only colour.
    const pink = within(noteEl(id)).getByRole('button', { name: 'Pink colour' });
    expect(pink.getAttribute('aria-pressed')).toBe('true');
    const yellow = within(noteEl(id)).getByRole('button', { name: 'Yellow colour' });
    expect(yellow.getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-28 the Sticky note button creates one note centred in the viewport, editing', () => {
    render(<App />);
    expect(noteCount()).toBe(0);

    clickByRole('Sticky note');

    expect(noteCount()).toBe(1);
    const id = snapshot(boardDoc())[0]!.id;
    // The viewport is the fake 1280x800 the test ResizeObserver reports.
    const expected = screenToWorld(readCamera(), { x: 1280 / 2, y: 800 / 2 });
    const s = noteEl(id).style;
    const centre = {
      x: parseFloat(s.left) + STICKY_SIZE_WORLD / 2,
      y: parseFloat(s.top) + STICKY_SIZE_WORLD / 2,
    };
    expect(centre.x).toBeCloseTo(expected.x, 1);
    expect(centre.y).toBeCloseTo(expected.y, 1);
    // Editing starts immediately so typing needs no further click.
    expect(within(noteEl(id)).queryByRole('textbox')).toBeTruthy();
  });

  it('TC-29 the bin button deletes the note and clears the selection', () => {
    render(<App />);
    const id = createNote(300, 300);
    clickNote(id);
    expect(noteSelected(id)).toBe(true);

    clickByRole('Delete note');

    expect(noteCount()).toBe(0);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });
});
