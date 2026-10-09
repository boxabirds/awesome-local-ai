import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_COLOR_NAMES,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  stickyColorLabel,
  type StickyColor,
} from '../../src/shared/config';
import {
  clickElement,
  createNote,
  pointerAt,
  docNotes,
  editorElement,
  noteElement,
  flushFrame,
  noteOf,
  noteToolbarElement,
  readCamera,
  renderBoard,
} from './harness';

const HALF = STICKY_SIZE_WORLD / 2;

/** jsdom reports inline colours as rgb(), so compare in the same form. */
function rgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

describe('sticky.toolbar - creating a note (TC-28)', () => {
  it('TC-28 the Sticky note button creates one note centred on the visible board', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });

    fireEvent.click(screen.getByTestId('create-sticky'));

    const notes = docNotes(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    // Centred on whatever the middle of the screen shows, in world units.
    const camera = readCamera();
    const centre = {
      x: camera.x + window.innerWidth / (2 * camera.zoom),
      y: camera.y + window.innerHeight / (2 * camera.zoom),
    };
    expect(note.x).toBe(centre.x - HALF);
    expect(note.y).toBe(centre.y - HALF);
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);

    // Selected, and editing starts immediately so typing goes straight in.
    expect(noteElement(note.id).getAttribute('data-selected')).toBe('true');
    expect(editorElement()).not.toBeNull();
    expect(document.activeElement).toBe(editorElement());
  });

  it('the create button carries the exact accessible name', () => {
    renderBoard();
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button.getAttribute('aria-label')).toBe('Sticky note');
    expect(screen.getByTestId('create-sticky')).toBe(button);
  });

  it('each click adds one note, stacked above the previous (z 1, 2, 3)', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });

    fireEvent.click(screen.getByTestId('create-sticky'));
    fireEvent.click(screen.getByTestId('create-sticky'));
    fireEvent.click(screen.getByTestId('create-sticky'));

    const notes = docNotes(doc);
    expect(notes).toHaveLength(3);
    expect(notes.map((note) => note.z)).toEqual([1, 2, 3]);
    // Only the newest one is selected, and it is being edited (so its note
    // toolbar is hidden while typing).
    expect(screen.queryAllByTestId(/^sticky-note-/u)).toHaveLength(3);
    expect(screen.queryAllByTestId('note-toolbar')).toHaveLength(0);
    expect(editorElement()).not.toBeNull();
    expect(editorElement()!.closest(`[data-sticky-note="${notes[2]!.id}"]`)).not.toBeNull();
    expect(noteElement(notes[2]!.id).getAttribute('data-selected')).toBe('true');
    expect(noteElement(notes[0]!.id).getAttribute('data-selected')).toBe('false');
  });

  it('TC-28 after a pan the new note is still centred on what the screen shows', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    await flushFrame();

    // Pan far away by dragging the empty board.
    pointerAt(screen.getByTestId('board'), 'pointerdown', 400, 300);
    pointerAt(screen.getByTestId('board'), 'pointermove', 400 - 5000, 300 - 4000);
    pointerAt(screen.getByTestId('board'), 'pointerup', 400 - 5000, 300 - 4000);
    await flushFrame();

    fireEvent.click(screen.getByTestId('create-sticky'));

    const note = docNotes(doc)[0]!;
    const camera = readCamera();
    expect(Math.abs(camera.x)).toBeGreaterThan(1000);
    const centre = {
      x: camera.x + window.innerWidth / (2 * camera.zoom),
      y: camera.y + window.innerHeight / (2 * camera.zoom),
    };
    expect(note.x).toBe(centre.x - HALF);
    expect(note.y).toBe(centre.y - HALF);
  });
});

describe('sticky.toolbar - colour (TC-27)', () => {
  function selectedNote() {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createNote(doc, { x: 300, y: 300 });
    clickElement(noteElement(id), 320, 320);
    return { doc, id };
  }

  it('TC-27 clicking the Pink swatch recolours the note and keeps it selected', () => {
    const { doc, id } = selectedNote();
    const before = noteOf(doc, id);

    fireEvent.click(screen.getByTestId('swatch-pink'));

    const after = noteOf(doc, id);
    expect(after.color).toBe('pink');
    // Text, position, stacking and creation time are untouched.
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    // Still selected, toolbar still there, drawn in the new colour.
    expect(noteElement(id).getAttribute('data-selected')).toBe('true');
    expect(noteToolbarElement()).not.toBeNull();
    expect(noteElement(id).style.background).toBe(rgb(STICKY_COLORS.pink));
  });

  it('all six swatches exist, in the six colours, and mark the current one', () => {
    const { id } = selectedNote();
    const toolbar = noteToolbarElement();
    expect(toolbar).not.toBeNull();

    const swatches = Array.from(toolbar!.querySelectorAll<HTMLButtonElement>('[data-testid^="swatch-"]'));
    expect(swatches.map((button) => button.getAttribute('data-color'))).toEqual(
      STICKY_COLOR_NAMES.slice(),
    );
    for (const name of STICKY_COLOR_NAMES) {
      const button = screen.getByTestId(`swatch-${name}`);
      expect(button.getAttribute('aria-pressed')).toBe(name === DEFAULT_STICKY_COLOR ? 'true' : 'false');
      expect(button.getAttribute('aria-label')).toBe(stickyColorLabel(name));
      expect(button.style.background).toBe(rgb(STICKY_COLORS[name]));
    }

    fireEvent.click(screen.getByTestId('swatch-violet'));
    expect(noteElement(id).getAttribute('data-selected')).toBe('true');
    const pressed = Array.from(
      noteToolbarElement()!.querySelectorAll<HTMLButtonElement>('[data-testid^="swatch-"]'),
    ).filter((button) => button.getAttribute('aria-pressed') === 'true');
    expect(pressed.map((button) => button.getAttribute('data-color'))).toEqual(['violet']);
  });

  it('every colour can be applied through the toolbar', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createNote(doc, { x: 300, y: 300 });
    clickElement(noteElement(id), 320, 320);

    const applied: StickyColor[] = [];
    for (const name of STICKY_COLOR_NAMES) {
      fireEvent.click(screen.getByTestId(`swatch-${name}`));
      applied.push(noteOf(doc, id).color);
    }
    expect(applied).toEqual(STICKY_COLOR_NAMES.slice());
  });

  it('clicking a swatch does not clear the selection or start editing', () => {
    const { id } = selectedNote();
    fireEvent.click(screen.getByTestId('swatch-blue'));
    expect(editorElement()).toBeNull();
    expect(noteElement(id).getAttribute('data-selected')).toBe('true');
  });
});

function selectedNote() {
  const doc = new Y.Doc();
  renderBoard({ doc });
  const id = createNote(doc, { x: 300, y: 300 });
  clickElement(noteElement(id), 320, 320);
  return { doc, id };
}

describe('sticky.toolbar - delete button (TC-29)', () => {
  it('TC-29 the bin button removes the note and clears the selection', () => {
    const { doc, id } = selectedNote();

    fireEvent.click(screen.getByTestId('delete-note'));

    expect(docNotes(doc)).toHaveLength(0);
    expect(screen.queryByTestId(`sticky-note-${id}`)).toBeNull();
    expect(screen.queryAllByTestId(/^sticky-note-/u)).toHaveLength(0);
    expect(noteToolbarElement()).toBeNull();
  });

  it('the delete button carries the exact accessible name', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const noteId = createNote(doc, { x: 300, y: 300 });
    clickElement(noteElement(noteId), 320, 320);

    const button = screen.getByRole('button', { name: 'Delete note' });
    expect(button.getAttribute('aria-label')).toBe('Delete note');
  });

  it('deleting one note leaves the others alone', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const keep = createNote(doc, { x: 100, y: 100 });
    const remove = createNote(doc, { x: 400, y: 100 });
    clickElement(noteElement(remove), 420, 120);

    fireEvent.click(screen.getByTestId('delete-note'));

    const notes = docNotes(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.id).toBe(keep);
  });

  it('the note toolbar is not shown for an unselected note, so its buttons are absent', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    createNote(doc, { x: 300, y: 300 });

    expect(noteToolbarElement()).toBeNull();
    expect(screen.queryByTestId('delete-note')).toBeNull();
    expect(screen.queryByTestId(`swatch-${STICKY_TEXT_MAX_CHARS > 0 ? 'pink' : 'pink'}`)).toBeNull();
  });
});
