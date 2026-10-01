import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getStickyText } from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  click,
  clickAt,
  deleteButton,
  editorElement,
  modelNotes,
  noteElement,
  noteElements,
  renderStickyBoard,
  seedNote,
  swatch,
  toolbarElement,
} from './stickyHarness';
import { SHORT_PHRASE } from '../fixtures/texts';

const STICKY_BUTTON = 'create-sticky-button';

/** The DOM normalises colours, so the expected hex is compared as the same `rgb()` form. */
const rgb = (hex: string): string => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};

describe('note.toolbar: colours', () => {
  it('TC-27 a colour swatch recolours the selected note and keeps it selected', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 }, { text: SHORT_PHRASE });
    renderStickyBoard(doc);

    clickAt(noteElement(id), 300, 200);
    expect(swatch('pink').getAttribute('aria-label')).toBe('Pink');
    expect(swatch('pink').getAttribute('aria-pressed')).toBe('false');

    click(swatch('pink'));

    expect(modelNotes(doc)[0]?.color).toBe('pink');
    expect(noteElement(id).getAttribute('data-color')).toBe('pink');
    // Negative cases: the note is still selected, its text and position are untouched.
    expect(noteElement(id).getAttribute('data-selected')).toBe('true');
    expect(toolbarElement()).toBeTruthy();
    expect(getStickyText(doc, id)?.toString()).toBe(SHORT_PHRASE);
    expect(modelNotes(doc)[0]?.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
    expect(swatch('pink').getAttribute('aria-pressed')).toBe('true');
  });

  it('every colour of the palette has a swatch, the default one marked', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);

    clickAt(noteElement(id), 300, 200);

    for (const [name, hex] of Object.entries(STICKY_COLORS)) {
      const element = swatch(name);
      expect(element.getAttribute('aria-label')).toBe(name.charAt(0).toUpperCase() + name.slice(1));
      expect(element.style.background).toBe(rgb(hex));
      expect(element.getAttribute('aria-pressed')).toBe(
        name === DEFAULT_STICKY_COLOR ? 'true' : 'false',
      );
    }
  });
});

describe('note.toolbar: delete', () => {
  it('TC-29 the bin button deletes the selected note and clears the selection', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);

    clickAt(noteElement(id), 300, 200);
    click(deleteButton());

    expect(modelNotes(doc)).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
    expect(toolbarElement()).toBeNull();
  });
});

describe('board.toolbar', () => {
  it('TC-28 the Sticky note button creates one note at the viewport centre and starts editing', () => {
    const doc = new Y.Doc();
    renderStickyBoard(doc);

    const button = document.querySelector(`[data-testid="${STICKY_BUTTON}"]`) as HTMLElement;
    expect(button.getAttribute('aria-label')).toBe('Sticky note (N)');

    click(button);

    const notes = modelNotes(doc);
    expect(notes).toHaveLength(1);
    // jsdom is 1024x768 and the home camera centres the world origin: the new note is centred
    // on (0, 0), and the toolbar button never moves the camera.
    expect(notes[0]?.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
    expect(notes[0]?.y).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
    expect(notes[0]?.color).toBe(DEFAULT_STICKY_COLOR);
    expect(editorElement()).toBeTruthy();
  });
});
