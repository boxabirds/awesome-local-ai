import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { screenToWorld } from '../../src/client/canvas/camera';
import { STICKY_BUTTON_TOOLTIP } from '../../src/client/board/Toolbar';
import { SHORT_TEXT } from '../fixtures/texts';
import { camera, note, noteEl, noteElements, press, renderApp, setCamera } from './helpers';

function click(el: HTMLElement) {
  press(el);
  act(() => el.click());
}

describe('toolbars (sticky.toolbar)', () => {
  it('the Sticky note button has an accessible name and tooltip', () => {
    renderApp();
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button).toHaveAttribute('title', STICKY_BUTTON_TOOLTIP);
    expect(STICKY_BUTTON_TOOLTIP).toBe('Sticky note – or double-click the board');
  });

  it('TC-28 the Sticky note button creates one note centred on the viewport, in editing mode', () => {
    const { doc } = renderApp();
    setCamera({ x: 5000, y: -3000, zoom: 0.5 });
    click(screen.getByRole('button', { name: 'Sticky note' }));
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const centre = screenToWorld(camera(), { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    expect(notes[0].x + STICKY_SIZE_WORLD / 2).toBeCloseTo(centre.x, 6);
    expect(notes[0].y + STICKY_SIZE_WORLD / 2).toBeCloseTo(centre.y, 6);
    expect(notes[0].color).toBe('yellow');
    expect(noteEl(notes[0].id)).toHaveAttribute('data-state', 'editing');
    expect(screen.getByRole('textbox', { name: 'Note text' })).toHaveFocus();
  });

  it('a new note is placed above existing notes', () => {
    const doc = new Y.Doc();
    const first = createSticky(doc, { x: 0, y: 0 });
    renderApp(doc);
    click(screen.getByRole('button', { name: 'Sticky note' }));
    const notes = snapshot(doc);
    expect(notes[0].id).toBe(first);
    expect(notes[1].z).toBeGreaterThan(notes[0].z);
    expect(noteElements()).toHaveLength(2);
    expect(Number(noteEl(notes[1].id).style.zIndex)).toBeGreaterThan(Number(noteEl(first).style.zIndex));
  });

  it('TC-27 clicking the Pink swatch recolours the note and keeps text, position and selection', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    getStickyText(doc, id)!.insert(0, SHORT_TEXT);
    renderApp(doc);
    press(noteEl(id));
    const before = note(doc, id)!;
    const swatches = screen.getAllByRole('button', { name: /colour$/ });
    expect(swatches.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Yellow colour',
      'Orange colour',
      'Green colour',
      'Blue colour',
      'Pink colour',
      'Violet colour',
    ]);
    expect(screen.getByRole('button', { name: 'Yellow colour' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Pink colour' })).toHaveAttribute('title', 'Pink colour');
    click(screen.getByRole('button', { name: 'Pink colour' }));
    expect(note(doc, id)).toEqual({ ...before, color: 'pink' });
    expect(noteEl(id).style.getPropertyValue('--note-color')).toBe(STICKY_COLORS.pink);
    expect(noteEl(id)).toHaveAttribute('data-selected', 'true');
    expect(screen.getByRole('button', { name: 'Pink colour' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Yellow colour' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-29 the bin button deletes the note and clears the selection', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const other = createSticky(doc, { x: 500, y: 0 });
    renderApp(doc);
    press(noteEl(id));
    click(screen.getByRole('button', { name: 'Delete note' }));
    expect(snapshot(doc).map((n) => n.id)).toEqual([other]);
    expect(screen.queryByRole('toolbar', { name: 'Note' })).toBeNull();
    expect(noteEl(other)).toHaveAttribute('data-selected', 'false');
  });

  it('the note toolbar is drawn above all notes, in the world overlay layer', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: -150 });
    renderApp(doc);
    press(noteEl(id));
    const toolbar = screen.getByRole('toolbar', { name: 'Note' });
    expect(screen.getByTestId('board-world-overlay')).toContainElement(toolbar);
  });
});
