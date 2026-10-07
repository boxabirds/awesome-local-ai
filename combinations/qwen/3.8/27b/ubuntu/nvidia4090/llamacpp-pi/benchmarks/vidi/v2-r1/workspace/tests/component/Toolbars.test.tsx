// Story 2 component tests: the Sticky note button and the note toolbar
// (TC-27 to TC-29).

import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderApp, hooks, addNote, note, click } from './helpers';
import { STICKY_COLORS } from '../../src/shared/config';

function theNote(): HTMLElement {
  const el = screen.queryByTestId('sticky-note');
  if (!el) throw new Error('no sticky note rendered');
  return el;
}

const noteToolbar = () => screen.queryByRole('toolbar', { name: 'Sticky note options' });

describe('toolbars (component)', () => {
  it('TC-27: clicking the Pink swatch recolors the note and keeps the selection', async () => {
    await renderApp();
    const id = addNote(0, 0);
    expect(note(id)!.color).toBe('yellow');

    const el = theNote();
    click(el);

    const pink = screen.getByRole('button', { name: 'Pink colour' });
    fireEvent.click(pink);

    expect(note(id)!.color).toBe('pink');
    expect(el).toHaveAttribute('data-selected'); // selection kept
    expect(noteToolbar()).toBeInTheDocument();
    expect(pink).toHaveAttribute('aria-pressed', 'true');
    const yellow = screen.getByRole('button', { name: 'Yellow colour' });
    expect(yellow).toHaveAttribute('aria-pressed', 'false');
    // The note element carries the new colour.
    expect(el).toHaveStyle({ background: STICKY_COLORS.pink });
  });

  it('TC-28: the Sticky note button creates one note centred on the viewport centre, in editing', async () => {
    await renderApp();
    const cam = hooks().getCamera();
    // The button creates the note at the viewport centre in screen space;
    // convert that to world coords the same way the app does.
    const wx = window.innerWidth / 2 + cam.x;
    const wy = window.innerHeight / 2 + cam.y;

    const button = screen.getByRole('button', { name: 'Sticky note' });
    fireEvent.click(button);

    const notes = hooks().getNotes();
    expect(notes).toHaveLength(1);
    // Top-left so the 200x200 note is centred on the viewport centre.
    expect(notes[0].x).toBeCloseTo(wx - 100, 5);
    expect(notes[0].y).toBeCloseTo(wy - 100, 5);
    expect(notes[0].color).toBe('yellow');
    expect(screen.getByTestId('sticky-editor')).toBeInTheDocument(); // Editing
    expect(screen.getByTestId('sticky-note')).toHaveAttribute('data-selected');
  });

  it('TC-29: the bin button deletes the selected note and clears the selection', async () => {
    await renderApp();
    const id = addNote(0, 0);

    const el = theNote();
    click(el);
    expect(noteToolbar()).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(note(id)).toBeUndefined();
    expect(hooks().getNotes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-note')).not.toBeInTheDocument();
    expect(noteToolbar()).not.toBeInTheDocument();
  });
});
