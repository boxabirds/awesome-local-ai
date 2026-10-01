// sticky.toolbar (ui-component): the Sticky note tool on the left rail, and the
// colour swatches and bin above the selected note.

import { describe, expect, it } from 'vitest';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { snapshot } from '../../src/shared/board-model';
import { SHORT_PHRASE } from '../fixtures/texts';
import {
  clickOn,
  deleteNoteButton,
  dragTo,
  editorElement,
  flushFrames,
  initialCamera,
  isEditing,
  modelText,
  newNote,
  noteAt,
  noteCount,
  noteOrder,
  notePosition,
  noteToolbarElement,
  noteToolbarOpen,
  pointerOn,
  pressKeyOn,
  readCamera,
  renderBoard,
  screenCentre,
  selectionCount,
  setNoteText,
  stickyToolButton,
  swatchElement,
  useBoardTestLifecycle,
} from './helpers';

const COLOR_NAMES = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'] as const;

function labelOf(color: string): string {
  return `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;
}

describe('sticky note toolbars', () => {
  useBoardTestLifecycle();

  it('TC-27 recolours the selected note with a named swatch and keeps it selected', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    clickOn(noteAt(0));

    const swatch = swatchElement('pink');
    expect(swatch).not.toBeNull();
    expect(swatch?.getAttribute('aria-label')).toBe('Pink colour');
    expect(swatch?.getAttribute('title')).toBe('Pink colour');

    clickOn(swatch);

    expect(snapshot(doc)[0].color).toBe('pink');
    expect(noteAt(0).dataset.color).toBe('pink');
    expect(noteAt(0).style.background).toBe('rgb(244, 143, 177)');
    expect(selectionCount()).toBe(1);
    expect(swatchElement('pink')?.getAttribute('aria-pressed')).toBe('true');
    expect(swatchElement('yellow')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('names all six colours in the order the board lists them', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    clickOn(noteAt(0));

    const toolbar = noteToolbarElement();
    expect(toolbar?.getAttribute('role')).toBe('toolbar');
    expect(COLOR_NAMES.map((color) => swatchElement(color)?.getAttribute('aria-label'))).toEqual(
      COLOR_NAMES.map(labelOf),
    );
    // the pressed swatch is the colour the note has now
    expect(swatchElement('yellow')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-27 recolouring changes nothing else about the note', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    setNoteText(doc, id, SHORT_PHRASE);
    clickOn(noteAt(0));
    const before = notePosition(0);
    const zBefore = noteOrder()[0].z;

    clickOn(swatchElement('green'));

    const note = snapshot(doc)[0];
    expect(note.color).toBe('green');
    expect(notePosition(0)).toEqual(before);
    expect(modelText(doc, id)).toBe(SHORT_PHRASE);
    expect(noteOrder()[0].z).toBe(zBefore);
  });

  it('choosing the colour the note already has changes no document at all', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    clickOn(noteAt(0));
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    clickOn(swatchElement('yellow'));

    expect(updates).toBe(0);
    expect(snapshot(doc)[0].color).toBe('yellow');
  });

  it('TC-29 deletes the note with the bin button and clears the selection', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    clickOn(noteAt(0));
    const bin = deleteNoteButton();
    expect(bin?.getAttribute('aria-label')).toBe('Delete note');

    clickOn(bin);

    expect(noteCount()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
    expect(selectionCount()).toBe(0);
    expect(noteToolbarOpen()).toBe(false);
  });

  it('TC-29 the bin leaves the other notes alone', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    const other = newNote(doc, { x: 400, y: 100 });
    clickOn(noteAt(0));

    clickOn(deleteNoteButton());

    expect(noteCount()).toBe(1);
    expect(snapshot(doc).map((note) => note.id)).toEqual([other]);
  });

  it('TC-28 creates one note centred on the middle of the board and opens it for typing', () => {
    const { doc } = renderBoard();
    const centre = screenCentre();
    const tool = stickyToolButton();
    // story 9 puts the key each tool answers to in its name, so the rail teaches
    // the shortcuts and the e2e tests can name one button without guessing
    expect(tool?.getAttribute('aria-label')).toBe('Sticky note (N)');
    expect(tool?.getAttribute('title')).toBe('Sticky note – N, or double-click the board');

    clickOn(tool);

    expect(noteCount()).toBe(1);
    expect(notePosition(0)).toEqual({ x: centre.x - STICKY_SIZE_WORLD / 2, y: centre.y - STICKY_SIZE_WORLD / 2 });
    expect(snapshot(doc)[0].color).toBe('yellow');
    expect(isEditing()).toBe(true);
    expect(editorElement()).not.toBeNull();
  });

  it('TC-28 creates the next note in the middle of the board too, on top', () => {
    renderBoard();

    clickOn(stickyToolButton());
    pressKeyOn(editorElement(), 'Escape');
    clickOn(stickyToolButton());

    expect(noteCount()).toBe(2);
    expect(noteOrder()[1].z).toBeGreaterThan(noteOrder()[0].z);
    expect(notePosition(0).x).not.toBe(notePosition(1).x - STICKY_SIZE_WORLD);
  });

  it('TC-28 still centres the new note after the board has been panned away', () => {
    renderBoard();
    // pan the board far from its starting place
    dragTo({ x: 600, y: 500 }, { x: -300, y: -120 });
    const centre = screenCentre();

    clickOn(stickyToolButton());

    expect(notePosition(0)).toEqual({
      x: centre.x - STICKY_SIZE_WORLD / 2,
      y: centre.y - STICKY_SIZE_WORLD / 2,
    });
    // the board stayed where the user left it
    expect(readCamera().x).not.toBe(initialCamera().x);
  });

  it('TC-28 the tool does not pan or zoom the board, and does not clear the selection', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    clickOn(noteAt(0));
    const camera = readCamera();

    clickOn(stickyToolButton());

    expect(readCamera()).toEqual(camera);
    expect(selectionCount()).toBe(1);
    // the old note keeps its place; the new one is on top of it
    expect(noteCount()).toBe(2);
  });

  it('hides the note tools while its note is being typed in', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    clickOn(noteAt(0));
    expect(noteToolbarOpen()).toBe(true);

    // Enter starts typing, which is when the tools must get out of the way
    pressKeyOn(noteAt(0), 'Enter');
    expect(isEditing()).toBe(true);
    expect(noteToolbarOpen()).toBe(false);

    pressKeyOn(editorElement(), 'Escape');
    expect(noteToolbarOpen()).toBe(true);
  });

  it('hides the note tools while the note is being dragged', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    clickOn(noteAt(0));
    expect(noteToolbarOpen()).toBe(true);

    const el = noteAt(0);
    pointerOn(el, 'pointerdown', { clientX: 10, clientY: 10 });
    pointerOn(el, 'pointermove', { clientX: 90, clientY: 40 });
    flushFrames();
    expect(noteAt(0).dataset.dragging).toBe('true');
    expect(noteToolbarOpen()).toBe(false);

    pointerOn(el, 'pointerup', { clientX: 90, clientY: 40 });
    flushFrames();
    expect(noteToolbarOpen()).toBe(true);
  });

  it('keeps the note tools out of the board: a swatch click does not deselect', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    clickOn(noteAt(0));

    // the toolbar sits above the note, where a click would otherwise be a click
    // on nothing at all
    clickOn(swatchElement('blue'));

    expect(selectionCount()).toBe(1);
    expect(snapshot(doc)[0].color).toBe('blue');
  });
});
