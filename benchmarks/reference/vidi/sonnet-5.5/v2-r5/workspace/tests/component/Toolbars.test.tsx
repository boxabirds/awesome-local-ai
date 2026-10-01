import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import './helpers';

afterEach(cleanup);

function createAndSelect() {
  fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  return screen.getByRole('group', { name: 'Sticky note' });
}

describe('toolbars', () => {
  it('TC-28 Sticky note button creates a centred yellow note in edit mode', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Sticky note' }).title).toBe('Sticky note – or double-click the board');
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const note = screen.getByRole('group', { name: 'Sticky note' });
    expect(screen.getAllByRole('group', { name: 'Sticky note' })).toHaveLength(1);
    expect(note.style.background).toBe(hex(STICKY_COLORS.yellow));
    // jsdom viewport is 1024x768 and the initial camera centres the origin on screen.
    expect(Number(note.dataset.x)).toBe(-STICKY_SIZE_WORLD / 2);
    expect(Number(note.dataset.y)).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.dataset.editing).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('TC-27 Pink swatch recolours and keeps the selection', () => {
    render(<App />);
    const note = createAndSelect();
    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));
    expect(note.style.background).toBe(hex(STICKY_COLORS.pink));
    expect(note.dataset.selected).toBe('true');
    expect(screen.getByRole('button', { name: 'Pink colour' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Yellow colour' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getAllByRole('button', { name: /colour$/ })).toHaveLength(6);
  });

  it('TC-29 bin button removes the note and clears the selection', () => {
    render(<App />);
    createAndSelect();
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(screen.queryByRole('group', { name: 'Sticky note' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
  });
});

function hex(c: string): string {
  const n = parseInt(c.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
}
