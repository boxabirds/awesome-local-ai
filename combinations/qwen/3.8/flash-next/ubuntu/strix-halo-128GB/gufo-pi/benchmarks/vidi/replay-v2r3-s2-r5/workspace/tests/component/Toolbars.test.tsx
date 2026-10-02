import { describe, it, expect } from 'vitest';
import {
  addNote,
  fireEvent,
  flushFrames,
  noteById,
  noteElements,
  notesOf,
  press,
  release,
  renderBoard,
  screen,
} from './stickyHarness';
import { STICKY_COLORS, DEFAULT_STICKY_COLOR, type StickyColor } from '../../src/shared/config';
import { snapshot } from '../../src/shared/board-model';

function selectNote(id: string, x = 350, y = 350): void {
  press(noteById(id), x, y);
  release(noteById(id), x, y);
}

describe('sticky.toolbar colour swatches', () => {
  // TC-27
  it('TC-27: clicking the Pink swatch recolours the note and keeps text, position and selection', () => {
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    selectNote(id);
    const before = snapshot(doc)[0];
    expect(before.color).toBe(DEFAULT_STICKY_COLOR);

    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));

    const after = snapshot(doc)[0];
    expect(after.color).toBe('pink');
    expect(STICKY_COLORS.pink).toBe('#F48FB1');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.text).toBe(before.text);
    expect(noteById(id).dataset.selected).toBe('true');
    expect(noteById(id).dataset.color).toBe('pink');
    // The toolbar stays open with the new swatch marked as pressed.
    expect(screen.getByRole('button', { name: 'Pink colour' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Yellow colour' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it.each(Object.keys(STICKY_COLORS) as StickyColor[])(
    'applies the %s swatch and keeps the note selected',
    (name) => {
      const { doc } = renderBoard();
      const id = addNote(doc, { x: 300, y: 300 });
      selectNote(id);

      fireEvent.click(screen.getByRole('button', { name: `${cap(name)} colour` }));

      expect(snapshot(doc)[0].color).toBe(name);
      expect(noteById(id).dataset.selected).toBe('true');
    },
  );

  it('swatch clicks do not clear the selection or reach the board', () => {
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    selectNote(id);

    // A pointerdown on the toolbar must not be seen by the viewport.
    const toolbar = screen.getByTestId('note-toolbar');
    fireEvent.pointerDown(toolbar, { pointerId: 1, clientX: 300, clientY: 200 });
    fireEvent.pointerUp(toolbar, { pointerId: 1, clientX: 300, clientY: 200 });

    expect(noteById(id).dataset.selected).toBe('true');
  });
});

describe('sticky.toolbar create button', () => {
  // TC-28
  it('TC-28: the Sticky note button creates one note centred on the viewport centre in edit mode', () => {
    const { doc } = renderBoard();
    const button = screen.getByRole('button', { name: 'Sticky note' });

    fireEvent.click(button);

    const notes = notesOf(doc);
    expect(notes).toHaveLength(1);
    const centre = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    expect(notes[0].x).toBe(centre.x - 100);
    expect(notes[0].y).toBe(centre.y - 100);
    expect(notes[0].color).toBe('yellow');
    expect(noteById(notes[0].id).dataset.editing).toBe('true');
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId('sticky-textarea'));
  });

  it('has the tooltip that explains the double-click shortcut', () => {
    renderBoard();
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button).toHaveAttribute(
      'title',
      'Sticky note – or double-click the board',
    );
  });

  it('stacks new notes on top of existing ones', () => {
    const { doc } = renderBoard();
    const button = screen.getByRole('button', { name: 'Sticky note' });

    fireEvent.click(button);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.click(button);

    const notes = notesOf(doc);
    expect(notes).toHaveLength(2);
    expect(notes[1].z).toBe(2);
    expect(noteElements()).toHaveLength(2);
  });
});

describe('sticky.toolbar delete button', () => {
  // TC-29
  it('TC-29: the bin button removes the note and clears the selection', () => {
    const { doc } = renderBoard();
    const [keep, drop] = [addNote(doc, { x: 0, y: 0 }), addNote(doc, { x: 500, y: 0 })];
    selectNote(drop, 550, 50);

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(notesOf(doc)).toHaveLength(1);
    expect(notesOf(doc)[0].id).toBe(keep);
    expect(noteElements()).toHaveLength(1);
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
  });

  it('leaves the other note selected state clean after deleting', async () => {
    const { doc } = renderBoard();
    const a = addNote(doc, { x: 0, y: 0 });
    const b = addNote(doc, { x: 500, y: 0 });
    selectNote(b, 550, 50);

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    await flushFrames();

    expect(noteById(a).dataset.selected).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
  });
});

function cap(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
