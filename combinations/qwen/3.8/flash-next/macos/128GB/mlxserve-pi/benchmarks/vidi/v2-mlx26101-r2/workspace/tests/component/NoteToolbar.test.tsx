import { beforeEach, describe, expect, it } from 'vitest';

import { fireEvent, screen } from './tl.js';
import {
  CENTRE,
  binButton,
  boardDoc,
  camera,
  clickBoard,
  clickStickyButton,
  colorSwatch,
  createSelectedNote,
  docNotes,
  editingNoteId,
  escapeFromEditor,
  flushFrames,
  noteData,
  noteElement,
  noteElements,
  noteId,
  noteScreenCentre,
  noteText,
  noteToolbarElement,
  pressAt,
  pressNote,
  pointerDown,
  pointerMove,
  pointerUp,
  renderApp,
  selectedNoteId,
  typeText,
} from './helpers.js';
import { STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from '../../src/shared/config.js';

/**
 * sticky.toolbar (ui-component): the left toolbar that creates notes and the
 * note toolbar that recolours and deletes one. Both are page chrome: they are
 * drawn at a constant size and a click on them must not reach the board.
 */

/** The six swatches in the order the PRD lists them. */
const ORDER: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

/** `#FFF59D` -> `rgb(255, 245, 157)`, the form jsdom and browsers report. */
function toRgb(hex: string): string {
  const digits = hex.replace('#', '');
  const parts = [0, 2, 4].map((index) => Number.parseInt(digits.slice(index, index + 2), 16));
  return `rgb(${parts.join(', ')})`;
}

beforeEach(() => {
  renderApp();
});

describe('sticky.toolbar: creating', () => {
  it('TC-28 creates one note in the middle of the view and opens it for typing', () => {
    clickStickyButton();

    expect(docNotes()).toHaveLength(1);
    // The view starts with world (0, 0) in its centre, so the new note - centred
    // on that middle - has its top-left one half note to the north-west.
    expect(noteData(0).x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
    expect(noteData(0).y).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
    expect(noteData(0).color).toBe('yellow');
    expect(editingNoteId()).toBe(noteId(0));
    expect(selectedNoteId()).toBe(noteId(0));
  });

  it('TC-28b puts the new note in the middle of the view after the board was panned', () => {
    // The user looked somewhere else: the note still appears where they are
    // looking, not at the board's origin.
    window.__vidi6?.setCamera({ x: 5000, y: -3000, zoom: 1 });
    flushFrames();

    clickStickyButton();

    expect(docNotes()).toHaveLength(1);
    // Wherever the note is in world units, it is on the middle of the screen.
    const centre = noteScreenCentre(0);
    expect(centre.x).toBeCloseTo(CENTRE.x, 6);
    expect(centre.y).toBeCloseTo(CENTRE.y, 6);
  });

  it('TC-34a leaves the camera alone when the button is clicked', () => {
    const before = camera();

    clickStickyButton();

    expect(camera()).toEqual(before);
  });

  it('TC-28c creates a second note on top of the first', () => {
    clickStickyButton();
    escapeFromEditor();
    const first = noteId(0);

    clickStickyButton();
    escapeFromEditor();

    expect(noteElements()).toHaveLength(2);
    expect(docNotes()[1].id).not.toBe(first);
    expect(docNotes()[1].z).toBeGreaterThan(docNotes()[0].z);
  });

  it('names the button and its tooltip', () => {
    const button = screen.getByRole('button', { name: 'Sticky note' });

    expect(button.title).toBe('Sticky note \u2013 or double-click the board');
  });
});

describe('sticky.toolbar: the note toolbar', () => {
  it('TC-27 recolours the selected note and keeps it selected', () => {
    createSelectedNote('Retro board');
    const before = noteData(0);

    fireEvent.click(colorSwatch('pink'));

    expect(noteData(0).color).toBe('pink');
    // Everything else about the note is untouched.
    expect(noteData(0).text).toBe('Retro board');
    expect(noteData(0).x).toBe(before.x);
    expect(noteData(0).y).toBe(before.y);
    expect(noteData(0).z).toBe(before.z);
    expect(selectedNoteId()).toBe(before.id);
    expect(noteElement(0).dataset.color).toBe('pink');
  });

  it('TC-27b marks the current colour as pressed and moves it with the change', () => {
    createSelectedNote();

    expect(colorSwatch('yellow').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(colorSwatch('blue'));

    expect(colorSwatch('blue').getAttribute('aria-pressed')).toBe('true');
    expect(colorSwatch('yellow').getAttribute('aria-pressed')).toBe('false');
    expect(noteData(0).color).toBe('blue');
  });

  it('TC-27c names every swatch, so colour is not the only way to tell them apart', () => {
    createSelectedNote();

    for (const name of ORDER) {
      const label = `${name[0]?.toUpperCase()}${name.slice(1)} colour`;
      const swatch = screen.getByRole('button', { name: label });
      expect(swatch).toBe(colorSwatch(name));
      expect(colorSwatch(name).title).toBe(`${name[0]?.toUpperCase()}${name.slice(1)}`);
    }
    // The toolbar is a group of options with a bin button in it.
    expect(screen.getByRole('group', { name: 'Note options' })).toBe(noteToolbarElement());
    expect(screen.getByRole('button', { name: 'Delete note' })).toBe(binButton());
  });

  it('TC-27d paints the swatches with the configured colours', () => {
    createSelectedNote();

    for (const name of ORDER) {
      // jsdom reports the colour in the form a browser computes: rgb().
      expect(colorSwatch(name).style.backgroundColor).toBe(toRgb(STICKY_COLORS[name]));
    }
  });

  it('TC-29 deletes the note and clears the selection', () => {
    createSelectedNote('Ship it');

    fireEvent.click(binButton());

    expect(docNotes()).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
    expect(selectedNoteId()).toBeNull();
    expect(noteToolbarElement()).toBeNull();
  });

  it('TC-29b deletes only the note whose toolbar was used', () => {
    createSelectedNote('First');
    clickStickyButton();
    typeText('Second');
    escapeFromEditor();
    expect(docNotes()).toHaveLength(2);

    // The toolbar belongs to the second note, which is the selected one.
    expect(selectedNoteId()).toBe(noteId(1));
    fireEvent.click(binButton());

    expect(docNotes()).toHaveLength(1);
    expect(noteText(0)).toBe('First');
  });

  it('TC-20c clicking the toolbar neither pans the board nor moves the note', () => {
    createSelectedNote('Retro board');
    const cameraBefore = camera();
    const before = noteData(0);

    // A press on the toolbar: the pointer events must not reach the board (which
    // would pan) or clear the selection (which would hide the toolbar).
    pressAt({ x: 640, y: 260 }, noteToolbarElement()!);

    expect(camera()).toEqual(cameraBefore);
    expect(noteData(0).x).toBe(before.x);
    expect(selectedNoteId()).toBe(before.id);
    expect(noteToolbarElement()).not.toBeNull();
  });

  it('TC-22b hides the note toolbar while the note is being edited', () => {
    clickStickyButton();
    typeText('Retro board');

    expect(editingNoteId()).toBe(noteId(0));
    expect(noteToolbarElement()).toBeNull();

    escapeFromEditor();

    expect(noteToolbarElement()).not.toBeNull();
  });

  it('TC-22c hides the note toolbar while the note is being dragged', () => {
    createSelectedNote('Retro board');
    const grab = noteScreenCentre(0);
    const element = noteElement(0);

    pointerDown(grab, element);
    pointerMove({ x: grab.x + 40, y: grab.y + 20 }, element);

    // Held in the drag: no toolbar, so it cannot be clicked by accident.
    expect(element.dataset.dragging).toBe('true');
    expect(noteToolbarElement()).toBeNull();

    pointerUp({ x: grab.x + 40, y: grab.y + 20 }, element);

    // Released: the note is selected again and its toolbar is back.
    expect(selectedNoteId()).toBe(noteId(0));
    expect(noteToolbarElement()).not.toBeNull();
  });

  it('TC-22d shows the toolbar only for the selected note', () => {
    createSelectedNote('First');
    clickStickyButton();
    escapeFromEditor();
    expect(docNotes()).toHaveLength(2);

    // Exactly one toolbar, and it is a child of the selected note.
    expect(document.querySelectorAll('[data-testid="note-toolbar"]')).toHaveLength(1);
    expect(noteElement(1).contains(noteToolbarElement())).toBe(true);

    pressNote(noteScreenCentre(0), noteElement(0));

    expect(noteElement(0).contains(noteToolbarElement())).toBe(true);
  });

  it('keeps the toolbar the same size on screen at 50%, 100% and 200% zoom', () => {
    createSelectedNote();

    const scaleAt = (zoom: number): number => {
      window.__vidi6?.setCamera({ x: -CENTRE.x / zoom, y: -CENTRE.y / zoom, zoom });
      flushFrames();
      return Number(noteElement(0).style.getPropertyValue('--inverse-zoom'));
    };

    expect(scaleAt(0.5)).toBeCloseTo(2, 6);
    expect(scaleAt(1)).toBeCloseTo(1, 6);
    expect(scaleAt(2)).toBeCloseTo(0.5, 6);
  });

  it('ignores a colour click for a note that is gone', () => {
    createSelectedNote();
    const id = noteId(0);
    // The note disappears (a delete from elsewhere) while its toolbar is open.
    fireEvent.click(binButton());

    expect(docNotes()).toHaveLength(0);
    expect(boardDoc().getMap('objects').get(id)).toBeUndefined();
    // Nothing to click any more, and nothing throws.
    expect(noteToolbarElement()).toBeNull();
  });

  it('leaves the selection where it was when the board itself is clicked', () => {
    createSelectedNote();
    expect(selectedNoteId()).toBe(noteId(0));

    clickBoard();

    expect(selectedNoteId()).toBeNull();
    // The board is still the board: clicking empty space created nothing.
    expect(docNotes()).toHaveLength(1);
  });
});
