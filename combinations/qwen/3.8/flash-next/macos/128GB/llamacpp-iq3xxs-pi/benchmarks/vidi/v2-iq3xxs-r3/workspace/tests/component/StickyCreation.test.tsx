/**
 * Sticky note creation (task 2.6): the left toolbar's Sticky note button and
 * the double-click shortcut, both landing in edit mode, plus Enter starting
 * editing on exactly one note (TC-36).
 */

import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Doc } from 'yjs';
import type { Doc as YDoc } from 'yjs';

import {
  dispatchKey,
  noteById,
  pointerEvent,
  readCamera,
  readNotes,
  renderStickyBoard,
  seedSticky,
  viewportElement,
  VIEWPORT_SIZE,
} from './helpers/board';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

let doc: YDoc;

beforeEach(() => {
  doc = new Doc();
  renderStickyBoard(doc);
});

afterEach(cleanup);

/** The world point the given screen point maps to at the current camera. */
function worldAt(screenPoint: { x: number; y: number }): { x: number; y: number } {
  const camera = readCamera();
  return {
    x: camera.x + screenPoint.x / camera.zoom,
    y: camera.y + screenPoint.y / camera.zoom,
  };
}

describe('sticky.create_button (TC-34)', () => {
  it('the Sticky note button creates a note at the centre of the visible board, in edit mode', () => {
    fireEvent.click(screen.getByTestId('create-sticky'));

    const notes = readNotes(doc);
    expect(notes).toHaveLength(1);
    const centre = worldAt({
      x: VIEWPORT_SIZE.width / 2,
      y: VIEWPORT_SIZE.height / 2,
    });
    // The note is centred on the viewport centre: x/y are the top-left.
    expect(notes[0].x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2);
    expect(notes[0].y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2);

    // Selected and editing right away.
    const note = noteById(notes[0].id);
    expect(note.dataset.selected).toBe('true');
    expect(screen.queryByTestId('sticky-textarea')).not.toBeNull();
  });
});

describe('sticky.create_dblclick (TC-35)', () => {
  it('a double-click on the empty board creates a note centred there, in edit mode', () => {
    const point = { x: 350, y: 300 };
    fireEvent.dblClick(viewportElement(), {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      button: 0,
    });

    const notes = readNotes(doc);
    expect(notes).toHaveLength(1);
    const world = worldAt(point);
    expect(notes[0].x).toBeCloseTo(world.x - STICKY_SIZE_WORLD / 2);
    expect(notes[0].y).toBeCloseTo(world.y - STICKY_SIZE_WORLD / 2);
    expect(screen.queryByTestId('sticky-textarea')).not.toBeNull();
  });

  it('a double-click on an existing note edits it instead of creating one', () => {
    let id = '';
    act(() => {
      id = seedSticky(doc, { x: 400, y: 300, text: 'Existing' });
    });
    const note = noteById(id);

    fireEvent.dblClick(note, { bubbles: true, cancelable: true, clientX: 450, clientY: 350 });
    expect(readNotes(doc)).toHaveLength(1); // no note on top of it
    expect(screen.queryByTestId('sticky-textarea')).not.toBeNull(); // and it edits
    expect(noteById(id).dataset.selected).toBe('true');
  });
});

describe('keyboard edit (TC-36)', () => {
  it('Enter starts editing the selected note; while editing, Enter does not start a second edit', () => {
    let first = '';
    let second = '';
    act(() => {
      first = seedSticky(doc, { x: 300, y: 300, text: 'First' });
      second = seedSticky(doc, { x: 700, y: 300, text: 'Second' });
    });

    // Select the first note with a short press.
    const note = noteById(first);
    pointerEvent('pointerDown', note, { x: 350, y: 350 });
    pointerEvent('pointerUp', note, { x: 350, y: 350 });

    dispatchKey({ key: 'Enter' });
    const textarea = screen.getByTestId('sticky-textarea');

    // Enter while editing: a newline in the text, no second edit session and
    // no editing on the second note.
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(screen.getAllByTestId('sticky-textarea')).toHaveLength(1);
    expect(noteById(second).querySelector('[data-testid="sticky-textarea"]')).toBeNull();
    // The second note is untouched.
    expect(noteById(second).dataset.selected).toBe('false');
    void first; // first id is referenced via its element above
  });
});
