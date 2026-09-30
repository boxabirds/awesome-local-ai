import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { STICKY_BUTTON_TOOLTIP } from '../../src/client/board/Toolbar';
import { createSticky, getStickyText, initDoc, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { SHORT_PHRASE } from '../fixtures/texts';
import { flushFrame, noteToolbar, pointer, renderApp, stickyNotes } from './helpers';

const CENTRE = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

function setupSelected() {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  if (id === false) throw new Error('create rejected');
  getStickyText(doc, id)?.insert(0, SHORT_PHRASE);
  renderApp(doc);
  const note = () => stickyNotes()[0];
  pointer(note(), 'down', CENTRE.x, CENTRE.y);
  pointer(note(), 'up', CENTRE.x, CENTRE.y);
  flushFrame();
  return { doc, id, note };
}

describe('sticky.toolbar', () => {
  it('TC-27 the Pink swatch recolours the note and keeps the selection', () => {
    const { doc, note } = setupSelected();
    const before = snapshot(doc)[0];
    const pink = screen.getByRole('button', { name: 'Pink colour' });
    expect(pink.getAttribute('title')).toBe('Pink colour');
    expect(pink.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Yellow colour' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.pointerDown(pink);
    fireEvent.click(pink);
    flushFrame();
    expect(snapshot(doc)[0]).toEqual({ ...before, color: 'pink' });
    expect(note().dataset.color).toBe('pink');
    expect(note().dataset.selected).toBe('true');
    expect(screen.getByRole('button', { name: 'Pink colour' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-28 the Sticky note button creates one note centred in the view, editing', () => {
    const doc = new Y.Doc();
    renderApp(doc);
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button.getAttribute('title')).toBe(STICKY_BUTTON_TOOLTIP);
    expect(STICKY_BUTTON_TOOLTIP).toBe('Sticky note – or double-click the board');
    fireEvent.click(button);
    flushFrame();
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    // Camera starts centred on world (0, 0), so the viewport centre is the origin.
    expect(notes[0]).toMatchObject({ x: -STICKY_SIZE_WORLD / 2, y: -STICKY_SIZE_WORLD / 2, color: 'yellow' });
    expect(stickyNotes()[0].dataset.editing).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Sticky note text' }));
  });

  it('the Sticky note button uses the current view when panned', () => {
    const doc = new Y.Doc();
    renderApp(doc);
    window.__vidi6?.setCamera({ x: 5000, y: -3000, zoom: 0.5 });
    flushFrame();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const [note] = snapshot(doc);
    expect(note.x + STICKY_SIZE_WORLD / 2).toBe(5000 + CENTRE.x / 0.5);
    expect(note.y + STICKY_SIZE_WORLD / 2).toBe(-3000 + CENTRE.y / 0.5);
  });

  it('a new note goes on top of existing notes', () => {
    const { doc } = setupSelected();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const notes = snapshot(doc);
    expect(notes.map((n) => n.z)).toEqual([1, 2]);
  });

  it('TC-29 the bin button deletes the note and clears the selection', () => {
    const { doc } = setupSelected();
    const bin = screen.getByRole('button', { name: 'Delete note' });
    fireEvent.pointerDown(bin);
    fireEvent.click(bin);
    flushFrame();
    expect(snapshot(doc)).toHaveLength(0);
    expect(stickyNotes()).toHaveLength(0);
    expect(noteToolbar()).toBeNull();
  });
});
