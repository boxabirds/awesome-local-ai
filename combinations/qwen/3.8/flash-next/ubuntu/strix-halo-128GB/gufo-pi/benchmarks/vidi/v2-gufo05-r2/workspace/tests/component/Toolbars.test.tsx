import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { snapshot } from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { clickNote, flushFrames, noteEl, renderApp, seedSticky } from './stickyHarness';

const HALF = STICKY_SIZE_WORLD / 2;

describe('sticky.toolbar', () => {
  it('TC-27: clicking the Pink swatch recolours the note and keeps the selection', () => {
    const doc = renderApp();
    const id = seedSticky(doc);
    clickNote(id);
    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));
    flushFrames();
    expect(snapshot(doc)[0]!.color).toBe('pink');
    // Text, position and selection are unchanged.
    expect(noteEl(id).dataset.selected).toBe('true');
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });

  it('TC-28: the Sticky note button creates a centred yellow note in edit mode', () => {
    const doc = renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    flushFrames();
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    // Centred on the visible board area (world 0,0 at the default camera).
    expect(notes[0]!.x).toBeCloseTo(-HALF, 5);
    expect(notes[0]!.y).toBeCloseTo(-HALF, 5);
    expect(notes[0]!.color).toBe(DEFAULT_STICKY_COLOR);
    // Editing starts immediately, so it accepts typing without another click.
    expect(document.querySelector('textarea')).not.toBeNull();
  });

  it('TC-29: the delete button removes the note and clears the selection', () => {
    const doc = renderApp();
    const id = seedSticky(doc);
    clickNote(id);
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    flushFrames();
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });
});
