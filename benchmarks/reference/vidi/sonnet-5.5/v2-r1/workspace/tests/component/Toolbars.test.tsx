import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { notes, press, release } from './helpers';

afterEach(cleanup);

function createViaButton() {
  fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
}
function createAndSelect() {
  createViaButton();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
}

describe('toolbars', () => {
  it('TC-27 pink swatch recolours and keeps the selection', () => {
    render(<App />);
    createAndSelect();
    const note = notes()[0];
    const yellow = note.style.background;
    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));
    expect(notes()[0].style.background).not.toBe(yellow);
    expect(notes()[0].dataset.selected).toBe('true');
    expect(screen.getByRole('button', { name: 'Pink colour' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Yellow colour' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-28 toolbar button creates a centred note in edit mode', () => {
    render(<App />);
    const button = screen.getByRole('button', { name: 'Sticky note (N)' });
    expect(button.getAttribute('title')).toBe('Sticky note (N) – or double-click the board');
    createViaButton();
    expect(notes()).toHaveLength(1);
    const note = notes()[0];
    // Initial camera centres the world origin on the viewport, so the note is centred on (0, 0).
    expect(note.style.left).toBe(`${-STICKY_SIZE_WORLD / 2}px`);
    expect(note.style.top).toBe(`${-STICKY_SIZE_WORLD / 2}px`);
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('TC-29 bin button deletes the note and clears selection', () => {
    render(<App />);
    createAndSelect();
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(notes()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
  });

  it('toolbar is hidden while editing and not offered for unselected notes', () => {
    render(<App />);
    createViaButton();
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
    press(screen.getByRole('button', { name: 'Green colour' }));
    release(screen.getByRole('button', { name: 'Green colour' }));
    expect(notes()[0].dataset.selected).toBe('true');
  });
});
