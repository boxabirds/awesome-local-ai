/**
 * Sticky note interaction (tasks 2.5-2.7): selection, the floating toolbar,
 * dragging with its frame coalescing and overlap handling, keyboard delete.
 * Component-level checks of the e2e flows TC-30/TC-31 live here too; the
 * browser-only parts (real pointer capture, hit-testing, layout) are in
 * tests/e2e/sticky-notes.spec.ts.
 */

import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Doc } from 'yjs';
import type { Doc as YDoc } from 'yjs';

import {
  flushFrame,
  noteById,
  pointerEvent,
  readCamera,
  readNote,
  readNotes,
  renderStickyBoard,
  seedSticky,
  setCamera,
  textOf,
  dispatchKey,
  viewportElement,
} from './helpers/board';
import { deleteObject } from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';

const NOTE = { x: 400, y: 300 }; // world coordinates of the note top-left
const INSIDE = { x: NOTE.x + 50, y: NOTE.y + 50 }; // same point at zoom 1

function pointInNote(dx: number, dy: number) {
  return { x: INSIDE.x + dx, y: INSIDE.y + dy };
}

let doc: YDoc;
let id: string;

beforeEach(() => {
  doc = new Doc();
  id = seedSticky(doc, { ...NOTE, text: 'Retro' });
  renderStickyBoard(doc);
});

afterEach(cleanup);

describe('sticky note selection (TC-18, TC-19, TC-22)', () => {
  it('TC-18: selecting a note shows its toolbar; clicking empty board hides it', () => {
    const note = noteById(id);
    expect(note.dataset.selected).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    pointerEvent('pointerDown', note, INSIDE);
    pointerEvent('pointerUp', note, INSIDE);
    expect(note.dataset.selected).toBe('true');
    expect(screen.queryByTestId('note-toolbar')).not.toBeNull();
    expect(screen.queryAllByTestId(/^swatch-/)).toHaveLength(6);
    expect(screen.queryByTestId('delete-note')).not.toBeNull();

    pointerEvent('pointerDown', viewportElement(), { x: 900, y: 650 });
    pointerEvent('pointerUp', viewportElement(), { x: 900, y: 650 });
    expect(note.dataset.selected).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-19: pressing and moving 2 px does not move the note, but selects it', () => {
    const note = noteById(id);
    pointerEvent('pointerDown', note, INSIDE);
    pointerEvent('pointerMove', note, pointInNote(2, 0));
    pointerEvent('pointerUp', note, pointInNote(2, 0));

    expect(note.dataset.selected).toBe('true');
    expect(parseFloat(note.dataset.x ?? '')).toBeCloseTo(NOTE.x);
    expect(readNote(doc, id)?.x).toBeCloseTo(NOTE.x);
    expect(textOf(doc, id)).toBe('Retro');
  });

  it('TC-22: click on empty board clears the selection; panning keeps it', () => {
    const note = noteById(id);
    pointerEvent('pointerDown', note, INSIDE);
    pointerEvent('pointerUp', note, INSIDE);

    // Pan: pointerdown -> movement past the pan threshold -> pointerup.
    pointerEvent('pointerDown', viewportElement(), { x: 800, y: 600 });
    pointerEvent('pointerMove', viewportElement(), { x: 900, y: 650 });
    pointerEvent('pointerUp', viewportElement(), { x: 900, y: 650 });
    expect(note.dataset.selected).toBe('true');

    // Click: press and release without movement.
    pointerEvent('pointerDown', viewportElement(), { x: 800, y: 600 });
    pointerEvent('pointerUp', viewportElement(), { x: 800, y: 600 });
    expect(note.dataset.selected).toBe('false');
  });
});

describe('sticky note dragging (TC-20, TC-21, TC-30, TC-31, TC-37)', () => {
  it('TC-20/TC-30: a dragged note follows the pointer exactly, ends selected, and the camera does not move', async () => {
    const cameraBefore = readCamera();
    const note = noteById(id);

    pointerEvent('pointerDown', note, INSIDE);
    pointerEvent('pointerMove', note, pointInNote(30, 8));
    await flushFrame();
    expect(note.dataset.dragging).toBe('true');
    // Hidden while dragging; on top of everything it overlaps: already
    // topmost as the only note, so no pointless z bump (TC-10 at model level).
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    expect(readNote(doc, id)?.z).toBe(1);

    pointerEvent('pointerMove', note, pointInNote(60, 15));
    pointerEvent('pointerUp', note, pointInNote(60, 15));

    const moved = readNote(doc, id);
    expect(moved?.x).toBeCloseTo(NOTE.x + 60);
    expect(moved?.y).toBeCloseTo(NOTE.y + 15);
    expect(parseFloat(note.dataset.x ?? '')).toBeCloseTo(NOTE.x + 60);
    expect(note.dataset.dragging).toBe('false');
    expect(note.dataset.selected).toBe('true');
    expect(readCamera()).toEqual(cameraBefore); // sticky.no_pan
  });

  it('TC-21: an interrupted drag keeps the last applied position; the next press selects', async () => {
    const note = noteById(id);
    pointerEvent('pointerDown', note, INSIDE);
    pointerEvent('pointerMove', note, pointInNote(10, 4)); // past the threshold
    pointerEvent('pointerMove', note, pointInNote(20, 6));
    await flushFrame(); // the queued frame applies
    const positionDuring = readNote(doc, id);
    expect(positionDuring?.x).toBeCloseTo(NOTE.x + 20);

    // A pointer-cancel interrupts; later events for the same press are
    // ignored: moving more changes nothing further.
    pointerEvent('pointerCancel', note, pointInNote(20, 6));
    pointerEvent('pointerMove', note, pointInNote(80, 30));
    pointerEvent('pointerUp', note, pointInNote(80, 30));
    await flushFrame();
    expect(readNote(doc, id)?.x).toBeCloseTo(positionDuring?.x ?? 0);
    expect(note.dataset.dragging).toBe('false');

    // The next press selects the note.
    pointerEvent('pointerDown', note, pointInNote(80, 30));
    pointerEvent('pointerUp', note, pointInNote(80, 30));
    expect(note.dataset.selected).toBe('true');
  });

  it('TC-31: at 50% zoom a 50 px drag is 100 world units (screen delta / zoom)', async () => {
    setCamera({ x: 0, y: 0, zoom: 0.5 });
    // At 0.5 zoom the note occupies (200, 150) .. (300, 250) on screen.
    const grab = { x: NOTE.x * 0.5 + 20, y: NOTE.y * 0.5 + 20 };
    const note = noteById(id);

    pointerEvent('pointerDown', note, grab);
    pointerEvent('pointerMove', note, { x: grab.x + 30, y: grab.y + 18 });
    await flushFrame();
    pointerEvent('pointerMove', note, { x: grab.x + 50, y: grab.y + 30 });
    pointerEvent('pointerUp', note, { x: grab.x + 50, y: grab.y + 30 });

    const moved = readNote(doc, id);
    expect(moved?.x).toBeCloseTo(NOTE.x + 100);
    expect(moved?.y).toBeCloseTo(NOTE.y + 60);
  });

  it('TC-37: a note deleted mid-drag ends the interaction with no further writes', async () => {
    const note = noteById(id);
    pointerEvent('pointerDown', note, INSIDE);
    pointerEvent('pointerMove', note, pointInNote(10, 4));
    pointerEvent('pointerMove', note, pointInNote(20, 6));

    // Another user deletes it mid-drag.
    act(() => {
      doc.transact(() => {
        deleteObject(doc, id);
      });
    });
    await flushFrame(); // frames must not resurrect or crash

    expect(readNotes(doc)).toHaveLength(0);
    expect(document.querySelector(`[data-note-id="${id}"]`)).toBeNull();
  });
});

describe('sticky note toolbars (TC-27, TC-28, TC-29)', () => {
  function select(idToSelect: string): void {
    const note = noteById(idToSelect);
    const point = {
      x: (readNote(doc, idToSelect)?.x ?? 0) + 50,
      y: (readNote(doc, idToSelect)?.y ?? 0) + 50,
    };
    pointerEvent('pointerDown', note, point);
    pointerEvent('pointerUp', note, point);
  }

  it('TC-27: a colour swatch recolours the note; its own swatch reads as pressed', () => {
    select(id);
    const note = noteById(id);
    expect(note.dataset.color).toBe(DEFAULT_STICKY_COLOR);
    expect(screen.getByTestId('swatch-yellow').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('swatch-pink'));
    expect(readNote(doc, id)?.color).toBe('pink');
    expect(note.dataset.color).toBe('pink');
    // The CSSOM normalises the hex to rgb() (as any browser does).
    const hex = STICKY_COLORS.pink.replace('#', '');
    const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
    expect(note.style.backgroundColor).toBe(rgb);
    expect(screen.getByTestId('swatch-pink').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('swatch-yellow').getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-28: dragging the lower of two overlapping notes brings it to the top', async () => {
    let under = '';
    let over = '';
    act(() => {
      under = seedSticky(doc, { x: 300, y: 300, text: 'Under' });
      over = seedSticky(doc, { x: 360, y: 300, text: 'Over' });
    });
    expect(readNote(doc, under)?.z ?? 0).toBeLessThan(readNote(doc, over)?.z ?? 0);

    const target = noteById(under);
    const grab = { x: 320, y: 480 }; // lower band of the note: not overlapped
    pointerEvent('pointerDown', target, grab);
    pointerEvent('pointerMove', target, { x: 360, y: 520 });
    await flushFrame();
    // Once the drag crosses the threshold it is topmost.
    const during = readNotes(doc);
    expect(during.find((n) => n.id === under)?.z ?? 0).toBeGreaterThan(
      during.find((n) => n.id === over)?.z ?? 0,
    );
    // A move after the last frame, written synchronously on pointerup.
    pointerEvent('pointerMove', target, { x: 380, y: 540 });
    pointerEvent('pointerUp', target, { x: 380, y: 540 });
    expect(readNote(doc, under)?.x).toBeCloseTo(300 + (380 - 320));
  });

  it('TC-29: the delete button removes the note and clears the selection', () => {
    select(id);
    expect(screen.queryByTestId('delete-note')).not.toBeNull();
    fireEvent.click(screen.getByTestId('delete-note'));
    expect(readNotes(doc)).toHaveLength(0);
    expect(document.querySelector(`[data-note-id="${id}"]`)).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });
});

describe('keyboard delete (TC-25)', () => {
  it('Delete and Backspace delete the selected note; nothing is selected afterwards', () => {
    const note = noteById(id);
    pointerEvent('pointerDown', note, INSIDE);
    pointerEvent('pointerUp', note, INSIDE);

    dispatchKey({ key: 'Delete' });
    expect(readNotes(doc)).toHaveLength(0);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    // And the same for Backspace with a second note.
    let second = '';
    act(() => {
      second = seedSticky(doc, { x: 700, y: 300, text: 'Second' });
    });
    const secondNote = noteById(second);
    pointerEvent('pointerDown', secondNote, { x: 750, y: 350 });
    pointerEvent('pointerUp', secondNote, { x: 750, y: 350 });
    dispatchKey({ key: 'Backspace' });
    expect(readNotes(doc)).toHaveLength(0);
  });
});

describe('size sanity', () => {
  it('renders the note as STICKY_SIZE_WORLD board units', () => {
    const note = noteById(id);
    expect(note.style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(note.style.height).toBe(`${STICKY_SIZE_WORLD}px`);
  });
});
