import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { stickies } from '../../src/shared/board-model';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { STICKY_NOTE_TOOLTIP } from '../../src/client/board/Toolbar';
import {
  boardSurface,
  clickNote,
  noteEl,
  renderBoard,
  seedSticky,
  stubViewportSize,
  textarea,
  VIEWPORT,
} from './boardHarness';

stubViewportSize();

/** jsdom normalises colours to rgb(); compare against the config value. */
function rgb(hex: string): string {
  const v = hex.replace('#', '');
  const parts = [0, 2, 4].map((i) => Number.parseInt(v.slice(i, i + 2), 16));
  return `rgb(${parts.join(', ')})`;
}

describe('sticky.toolbar: colour and delete on the selected note', () => {
  function selectedNote() {
    const doc = new Y.Doc();
    const id = seedSticky(doc, { x: 300, y: 200 }, { text: 'Faster onboarding' });
    const utils = renderBoard(doc);
    clickNote(noteEl(utils.container, id));
    return { doc, id, ...utils };
  }

  it('TC-27 clicking the Pink swatch recolours the note and keeps the selection', () => {
    const { container, doc, id } = selectedNote();
    const before = stickies(doc)[0];
    expect(before.color).toBe('yellow');

    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));

    const after = stickies(doc)[0];
    expect(after.color).toBe('pink');
    // Text, position, stacking and the id are untouched.
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.id).toBe(id);
    // Still selected with its toolbar.
    expect(noteEl(container, id).getAttribute('data-selected')).toBe('true');
    expect(screen.queryByRole('toolbar', { name: 'Sticky note options' })).not.toBeNull();
    expect(noteEl(container, id).style.backgroundColor).toBe(rgb(STICKY_COLORS.pink));
  });

  it('the six swatches are named, tooltiped and mark the current colour', () => {
    const { doc } = selectedNote();
    const names = ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet'];
    expect(Object.keys(STICKY_COLORS)).toEqual(names.map((n) => n.toLowerCase()));
    for (const name of names) {
      const swatch = screen.getByRole('button', { name: `${name} colour` });
      expect(swatch.getAttribute('title')).toBe(`${name} colour`);
      expect(swatch).toHaveAttribute('aria-pressed', name === 'Yellow' ? 'true' : 'false');
    }

    fireEvent.click(screen.getByRole('button', { name: 'Violet colour' }));
    expect(stickies(doc)[0].color).toBe('violet');
    expect(screen.getByRole('button', { name: 'Violet colour' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('TC-29 the bin button deletes the note and clears the selection', () => {
    const { container, doc } = selectedNote();
    expect(stickies(doc)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(stickies(doc)).toHaveLength(0);
    expect(container.querySelector('[data-sticky-note]')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Sticky note options' })).toBeNull();
  });

  it('a click on the note toolbar does not clear the selection or reach the board', () => {
    const { container, id } = selectedNote();
    const toolbar = screen.getByRole('toolbar', { name: 'Sticky note options' });
    fireEvent.pointerDown(toolbar, { clientX: 10, clientY: 0, button: 0, pointerId: 4 });
    fireEvent.pointerUp(toolbar, { clientX: 10, clientY: 0, button: 0, pointerId: 4 });
    expect(noteEl(container, id).getAttribute('data-selected')).toBe('true');
  });
});

describe('sticky.toolbar: Sticky note button', () => {
  it('TC-28 the button creates one yellow note, centred on the viewport, ready to type in', () => {
    const doc = new Y.Doc();
    const { container } = renderBoard(doc);

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));

    const notes = stickies(doc);
    expect(notes).toHaveLength(1);
    // The camera centres the world origin, so the viewport centre is world (0,0).
    expect(notes[0].x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(notes[0].y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(notes[0].color).toBe('yellow');
    expect(notes[0].text).toBe('');

    // Editing is active straight away.
    const editor = textarea(container);
    expect(editor).not.toBeNull();
    expect(document.activeElement).toBe(editor);
    fireEvent.change(editor!, { target: { value: 'Hello' } });
    expect(stickies(doc)[0].text).toBe('Hello');
  });

  it('TC-28b after panning, the new note is centred on the visible area, on top of the rest', () => {
    const doc = new Y.Doc();
    const existing = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);

    // Pan the board by (200, 100) screen pixels: the visible centre moves to
    // world (-200, -100).
    const surface = boardSurface(container);
    fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 600, clientY: 400, button: 0, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 600, clientY: 400, button: 0, pointerId: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));

    const notes = stickies(doc);
    expect(notes).toHaveLength(2);
    const created = notes.find((n) => n.id !== existing)!;
    expect(created).toBeDefined();
    expect(created.x).toBe(-200 - STICKY_SIZE_WORLD / 2);
    expect(created.y).toBe(-100 - STICKY_SIZE_WORLD / 2);
    // New notes are on top of all other notes.
    expect(notes[notes.length - 1].id).toBe(created.id);
    expect(created.z).toBeGreaterThan(notes[0].z);
  });

  it('the toolbar button carries the exact tooltip from the PRD', () => {
    const doc = new Y.Doc();
    renderBoard(doc);
    const button = screen.getByRole('button', { name: 'Sticky note (N)' });
    expect(button).toHaveAttribute('title', 'Sticky note \u2013 or double-click the board');
    expect(STICKY_NOTE_TOOLTIP).toBe('Sticky note \u2013 or double-click the board');
  });

  it('double-clicking empty board space creates a note centred on the point and edits it', () => {
    const doc = new Y.Doc();
    const { container } = renderBoard(doc);
    const surface = boardSurface(container);

    fireEvent.doubleClick(surface, { clientX: 400, clientY: 300 });

    const notes = stickies(doc);
    expect(notes).toHaveLength(1);
    // Viewport-relative point (400, 300), camera centred at (-640, -400), zoom 1.
    const worldX = 400 + -VIEWPORT.width / 2;
    const worldY = 300 + -VIEWPORT.height / 2;
    expect(notes[0].x).toBe(worldX - STICKY_SIZE_WORLD / 2);
    expect(notes[0].y).toBe(worldY - STICKY_SIZE_WORLD / 2);
    expect(notes[0].color).toBe('yellow');
    const editor = textarea(container);
    expect(editor).not.toBeNull();
    fireEvent.change(editor!, { target: { value: 'Hello' } });
    expect(stickies(doc)[0].text).toBe('Hello');
  });

  it('double-clicking empty space stacks the new note on top of an existing one', () => {
    const doc = new Y.Doc();
    const first = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);
    fireEvent.doubleClick(boardSurface(container), { clientX: 500, clientY: 500 });
    const notes = stickies(doc);
    expect(notes.map((n) => n.id)).toEqual([first, notes[1].id]);
    expect(notes[1].z).toBe(2);
  });
});

describe('sticky.toolbar: keyboard focus and board shortcuts', () => {
  function selectedNoteWithFocusedSwatch() {
    const doc = new Y.Doc();
    const id = seedSticky(doc, { x: 300, y: 200 }, { text: 'Faster onboarding' });
    const utils = renderBoard(doc);
    clickNote(noteEl(utils.container, id));
    screen.getByRole('button', { name: 'Green colour' }).focus();
    return { doc, id, ...utils };
  }

  it('Enter with a swatch focused is left to the button, so no editor opens', () => {
    const { container, doc } = selectedNoteWithFocusedSwatch();
    // jsdom does not turn Enter on a button into a click; what is pinned here is
    // that the board shortcut stays out of the way. Chromium (e2e) covers the
    // activation itself.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Green colour' }), { key: 'Enter' });
    expect(textarea(container)).toBeNull();
    expect(stickies(doc)[0].color).toBe('yellow');
  });

  it('Delete still removes the note while a swatch has focus', () => {
    const { container, doc } = selectedNoteWithFocusedSwatch();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Green colour' }), { key: 'Delete' });
    expect(stickies(doc)).toHaveLength(0);
    expect(container.querySelector('[data-sticky-note]')).toBeNull();
  });

  it('Enter with the note focused starts editing', () => {
    const { container, id } = selectedNoteWithFocusedSwatch();
    const note = noteEl(container, id);
    note.focus();
    fireEvent.keyDown(note, { key: 'Enter' });
    expect(textarea(container)).not.toBeNull();
  });
});
