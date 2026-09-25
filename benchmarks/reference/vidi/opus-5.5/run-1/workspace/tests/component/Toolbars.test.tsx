import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Toolbar } from '../../src/client/board/Toolbar';
import { resetCamera, screenToWorld } from '../../src/client/canvas/camera';
import { NoteToolbar } from '../../src/client/objects/NoteToolbar';
import { STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from '../../src/shared/config';
import { TEST_VIEWPORT } from './setup';
import {
  createSelectedNote,
  editor,
  noteEls,
  noteToolbar,
  notes,
  onlyNoteEl,
  renderBoard,
  user,
} from './stickyHelpers';

const HALF = 2;
const COLOUR_LABELS = ['Yellow colour', 'Orange colour', 'Green colour', 'Blue colour', 'Pink colour', 'Violet colour'];

describe('sticky.toolbar components', () => {
  it('Sticky note button has its name and tooltip', () => {
    const onCreate = vi.fn();
    render(<Toolbar onCreateSticky={onCreate} />);
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button.getAttribute('title')).toBe('Sticky note – or double-click the board');
    fireEvent.click(button);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('NoteToolbar shows six named swatches (pressed = current colour) and a delete button', () => {
    const onColor = vi.fn();
    const onDelete = vi.fn();
    render(<NoteToolbar color="green" onColor={onColor} onDelete={onDelete} />);
    const swatches = COLOUR_LABELS.map((name) => screen.getByRole('button', { name }));
    expect(swatches).toHaveLength(Object.keys(STICKY_COLORS).length);
    for (const s of swatches) expect(s.getAttribute('title')).toBe(s.getAttribute('aria-label'));
    expect(swatches.map((s) => s.getAttribute('aria-pressed'))).toEqual([
      'false', 'false', 'true', 'false', 'false', 'false',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Violet colour' }));
    expect(onColor).toHaveBeenCalledWith('violet' satisfies StickyColor);
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('sticky.toolbar in the app', () => {
  beforeEach(() => {
    renderBoard();
  });

  it('TC-27 clicking the Pink swatch recolours the note and keeps the selection', async () => {
    const u = user();
    const el = createSelectedNote();
    const before = notes()[0]!;
    await u.click(screen.getByRole('button', { name: 'Pink colour' }));
    const after = notes()[0]!;
    expect(after).toEqual({ ...before, color: 'pink' });
    expect(el.dataset.selected).toBe('true');
    expect(el.style.backgroundColor).toBe('rgb(244, 143, 177)'); // STICKY_COLORS.pink
    expect(screen.getByRole('button', { name: 'Pink colour' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-28 Sticky note button creates one note centred in the view, in edit mode', async () => {
    const u = user();
    expect(noteEls()).toHaveLength(0);
    await u.click(screen.getByRole('button', { name: 'Sticky note' }));
    expect(notes()).toHaveLength(1);
    const centre = screenToWorld(resetCamera(TEST_VIEWPORT), {
      x: TEST_VIEWPORT.width / HALF,
      y: TEST_VIEWPORT.height / HALF,
    });
    const note = notes()[0]!;
    expect(note.x + STICKY_SIZE_WORLD / HALF).toBe(centre.x);
    expect(note.y + STICKY_SIZE_WORLD / HALF).toBe(centre.y);
    expect(onlyNoteEl().dataset.editing).toBe('true');
    expect(document.activeElement).toBe(editor());
    await u.keyboard('Hi');
    expect(notes()[0]!.text).toBe('Hi');
  });

  it('TC-29 the bin button removes the note and clears the selection', async () => {
    const u = user();
    createSelectedNote();
    await u.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(notes()).toHaveLength(0);
    expect(noteEls()).toHaveLength(0);
    expect(noteToolbar()).toBeNull();
  });

  it('the note toolbar is hidden while editing', () => {
    createSelectedNote();
    expect(noteToolbar()).not.toBeNull();
    fireEvent.keyDown(onlyNoteEl(), { key: 'Enter' });
    expect(editor()).not.toBeNull();
    expect(noteToolbar()).toBeNull();
  });
});
