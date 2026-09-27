// Component tests (jsdom): the two toolbars. The board toolbar exposes the
// Sticky note button with the exact product tooltip; the note toolbar offers six
// named colour swatches (current one pressed) and a delete button, and swallows
// pointer events so it never reaches the board. Covers TC-27, TC-28, TC-29.
//
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { STICKY_BUTTON_TOOLTIP, Toolbar } from '../../src/client/board/Toolbar';
import { NoteToolbar } from '../../src/client/objects/NoteToolbar';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

describe('board toolbar', () => {
  it('shows a Sticky note button with the exact tooltip and creates on click', () => {
    const onCreate = vi.fn();
    render(<Toolbar onCreateSticky={onCreate} />);
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button.getAttribute('title')).toBe('Sticky note – or double-click the board');
    expect(STICKY_BUTTON_TOOLTIP).toBe('Sticky note – or double-click the board');
    fireEvent.click(button);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

describe('note toolbar', () => {
  const names = Object.keys(STICKY_COLORS) as StickyColor[];

  it('renders one swatch per colour plus a delete button', () => {
    render(<NoteToolbar color="yellow" onColor={() => {}} onDelete={() => {}} />);
    for (const name of names) {
      expect(screen.getByRole('button', { name: `${cap(name)} colour` })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
  });

  it('marks the current colour pressed, not the others', () => {
    render(<NoteToolbar color="green" onColor={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole('button', { name: 'Green colour' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Yellow colour' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('reports the chosen colour and delete', () => {
    const onColor = vi.fn();
    const onDelete = vi.fn();
    render(<NoteToolbar color="blue" onColor={onColor} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));
    expect(onColor).toHaveBeenCalledWith('pink');
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('swallows pointerdown so it never bubbles to an ancestor', () => {
    render(<NoteToolbar color="yellow" onColor={() => {}} onDelete={() => {}} />);
    let reached = false;
    const listener = () => (reached = true);
    document.addEventListener('pointerdown', listener);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Delete note' }));
    document.removeEventListener('pointerdown', listener);
    expect(reached).toBe(false);
  });
});

function cap(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
