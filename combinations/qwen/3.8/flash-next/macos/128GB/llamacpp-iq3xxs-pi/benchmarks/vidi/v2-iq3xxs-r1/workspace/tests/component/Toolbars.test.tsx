import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../../src/client/App';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  clickCreateSticky,
  clickElement,
  clickEmptyBoard,
  clickWithPointer,
  createUnselectedNote,
  getSelection,
  getSnapshot,
  noteEl,
  press,
} from './stickyUtil';

const AT = { x: 300, y: 200 };

/** Select an existing note with the pointer so its toolbar appears. */
function selectNote(): void {
  clickWithPointer(noteEl(), AT);
  expect(screen.getByTestId('note-toolbar')).not.toBeNull();
}

describe('toolbars (sticky.interaction)', () => {
  // TC-27: the colour swatches recolour the selected note without moving it.
  it('TC-27 recolours the selected note through the Pink swatch', async () => {
    render(<App sync={false} />);
    const note = await createUnselectedNote(); // default colour yellow
    expect(note.color).toBe('yellow');
    selectNote();

    const pink = screen.getByTestId('color-pink');
    expect(pink.getAttribute('aria-label')).toBe('Pink colour');
    expect(pink.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('color-yellow').getAttribute('aria-pressed')).toBe('true');

    await clickElement(pink);

    const after = getSnapshot()[0]!;
    expect(after.color).toBe('pink');
    expect(after.x).toBe(note.x); // recolouring never moves the note
    expect(after.y).toBe(note.y);
    expect(after.z).toBe(note.z);
    expect(getSelection().selectedId).toBe(note.id); // and it stays selected
    expect(noteEl().dataset.color).toBe('pink');
    expect(screen.getByTestId('color-pink').getAttribute('aria-pressed')).toBe('true');
  });

  it('offers exactly the six note colours as accessible swatches', async () => {
    render(<App sync={false} />);
    await clickCreateSticky();
    await press('{Escape}');

    const colours = Object.keys(STICKY_COLORS);
    const swatches = screen.getAllByRole('button', { name: /colour$/i });
    expect(swatches).toHaveLength(colours.length);
    expect(swatches.map((b) => b.getAttribute('aria-label'))).toEqual(
      colours.map((c) => `${c[0]!.toUpperCase()}${c.slice(1)} colour`),
    );
    expect(screen.getByRole('button', { name: 'Delete note' })).not.toBeNull();
  });

  // TC-28: the toolbar button creates a note in the centre, ready to type.
  it('TC-28 creates a note in the centre of the board and starts editing it', async () => {
    render(<App sync={false} />);
    const button = screen.getByTestId('create-sticky');
    expect(button.getAttribute('aria-label')).toBe('Sticky note');
    expect(button.getAttribute('title')).toBe('Sticky note – or double-click the board');

    await clickElement(button);

    const created = getSnapshot();
    expect(created).toHaveLength(1);
    const note = created[0]!;
    // viewport centre in jsdom is (512, 384) and the camera starts centred on
    // world (0, 0), so the new note is centred there
    expect(note.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
    expect(note.y).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
    expect(note.color).toBe('yellow');
    expect(note.text).toBe('');
    expect(getSelection()).toEqual({ selectedId: note.id, editingId: note.id });
    expect(document.activeElement).toBe(screen.getByTestId('sticky-note-input'));

    await press('Ship v2');
    expect(getSnapshot()[0]!.text).toBe('Ship v2');
    expect(getSelection().editingId).toBe(note.id); // still editing after typing
    expect(noteEl().dataset.editing).toBe('true');
  });

  // TC-29: the bin button removes the note and its toolbar.
  it('TC-29 removes the note and its toolbar with the delete button', async () => {
    render(<App sync={false} />);
    await createUnselectedNote();
    selectNote();

    await clickElement(screen.getByTestId('delete-note'));

    expect(getSnapshot()).toHaveLength(0);
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(0);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    expect(getSelection()).toEqual({ selectedId: null, editingId: null });
  });

  it('shows the toolbar only while the note is selected and not edited', async () => {
    render(<App sync={false} />);
    await clickCreateSticky();
    expect(screen.queryByTestId('note-toolbar')).toBeNull(); // editing: no toolbar
    expect(screen.getByTestId('sticky-note-input')).not.toBeNull();

    await press('{Escape}');
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();

    clickEmptyBoard({ x: 12, y: 40 }); // clicking empty board space clears selection
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });
});
