import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { STICKY_COLORS } from '../../src/shared/config';
import { clickEmptyBoard, clickNote, createByDblClick, notes } from './helpers';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Toolbars', () => {
  it('Sticky note button has an accessible name and tooltip', () => {
    render(<App />);
    const b = screen.getByRole('button', { name: 'Sticky note' });
    expect(b.getAttribute('title')).toBe('Sticky note – or double-click the board');
  });

  it('TC-27 Pink swatch recolours and keeps the selection', () => {
    render(<App />);
    const note = createByDblClick();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi' } });
    clickEmptyBoard();
    clickNote(note);
    const left = note.style.left;
    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));
    expect(notes()[0].dataset.color).toBe('pink');
    expect(notes()[0].style.background).not.toBe('');
    expect(STICKY_COLORS.pink).toBe('#F48FB1');
    expect(notes()[0].dataset.selected).toBe('true');
    expect(notes()[0].style.left).toBe(left);
    expect(notes()[0].querySelector('.sticky-text')?.textContent).toBe('hi');
    expect(screen.getByRole('button', { name: 'Pink colour' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Yellow colour' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('has six distinctly named swatches', () => {
    render(<App />);
    const note = createByDblClick();
    clickEmptyBoard();
    clickNote(note);
    const names = ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet'];
    for (const n of names) expect(screen.getByRole('button', { name: `${n} colour` })).toBeTruthy();
  });

  it('TC-28 Sticky note button creates a note at the viewport centre in edit mode', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    expect(notes()).toHaveLength(1);
    const note = notes()[0];
    // Camera starts centred on the world origin, so the note is centred on (0, 0).
    expect(note.style.left).toBe('-100px');
    expect(note.style.top).toBe('-100px');
    expect(note.dataset.editing).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('TC-29 bin button removes the note and clears the selection', () => {
    render(<App />);
    const note = createByDblClick();
    clickEmptyBoard();
    clickNote(note);
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(notes()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
  });
});
