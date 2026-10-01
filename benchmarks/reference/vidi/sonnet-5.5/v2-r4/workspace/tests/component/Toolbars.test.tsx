import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { stickies } from '../../src/shared/board-model';
import { click, noteEl, noteEls, setupBoard } from './helpers';

afterEach(cleanup);

describe('toolbars', () => {
  it('TC-27 a colour swatch recolours the note and keeps the selection', () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    click(noteEl());
    const pink = screen.getByRole('button', { name: 'Pink colour' });
    expect(pink.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pink);
    expect(stickies(doc)[0].color).toBe('pink');
    expect(noteEl().getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Pink colour' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-28 the Sticky note button creates a centred note in edit mode', () => {
    const { doc } = setupBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    const notes = stickies(doc);
    expect(notes).toHaveLength(1);
    // jsdom window is 1024x768 and the starting camera centres the origin on screen.
    expect(notes[0].x + 100).toBe(0);
    expect(notes[0].y + 100).toBe(0);
    expect(notes[0].color).toBe('yellow');
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('the Sticky note button has the specified tooltip', () => {
    setupBoard();
    expect(screen.getByRole('button', { name: 'Sticky note (N)' }).getAttribute('title')).toBe(
      'Sticky note (N) – or double-click the board',
    );
  });

  it('TC-29 the bin button removes the note and clears the selection', () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    click(noteEl());
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(stickies(doc)).toHaveLength(0);
    expect(noteEls()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
  });
});
