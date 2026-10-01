import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { addNote, click, noteEl, notes, renderBoard } from './board';
import { readCamera } from './helpers';

describe('toolbars', () => {
  it('the Sticky note button has the specified name and tooltip', () => {
    renderBoard();
    const button = screen.getByRole('button', { name: 'Sticky note (N)' });
    expect(button.getAttribute('title')).toBe('Sticky note (N) – or double-click the board');
  });

  it('TC-27 the Pink swatch recolours and keeps the selection', () => {
    const { doc } = renderBoard();
    const id = addNote(doc, 0, 0);
    click(noteEl(id));
    const before = notes(doc)[0];
    const pink = screen.getByRole('button', { name: 'Pink colour' });
    expect(pink.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pink);
    expect(notes(doc)[0]).toEqual({ ...before, color: 'pink' });
    expect(noteEl(id).dataset.selected).toBe('true');
    expect(screen.getByRole('button', { name: 'Pink colour' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-28 the Sticky note button creates a centred note in edit mode', () => {
    const { doc, world } = renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    expect(notes(doc)).toHaveLength(1);
    const cam = readCamera(world);
    const [n] = notes(doc);
    expect(n.x + 100).toBeCloseTo(window.innerWidth / 2 + cam.x, 6);
    expect(n.y + 100).toBeCloseTo(window.innerHeight / 2 + cam.y, 6);
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('TC-29 the bin button removes the note and clears the selection', () => {
    const { doc } = renderBoard();
    const id = addNote(doc, 0, 0);
    click(noteEl(id));
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(notes(doc)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
  });
});
