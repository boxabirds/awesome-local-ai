import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, getStickyText } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { resetCamera, screenToWorld } from '../../src/client/canvas/camera';
import { Toolbar } from '../../src/client/board/Toolbar';
import { NoteToolbar } from '../../src/client/objects/NoteToolbar';
import { flushFrame, readCamera } from './helpers';
import { click, editor, model, noteEl, notes, renderBoard } from './boardHelpers';

const HALF = STICKY_SIZE_WORLD / 2;
const COLOURS = ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet'];

function selectedBoard() {
  const doc = new Y.Doc();
  const id = createSticky(doc, { x: 40, y: 40 });
  getStickyText(doc, id)?.insert(0, 'Faster onboarding');
  const board = renderBoard(doc);
  click(noteEl(id));
  return { ...board, id };
}

describe('sticky.toolbar', () => {
  it('Sticky note button has its accessible name and tooltip', () => {
    render(<Toolbar onCreateSticky={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button).toHaveAttribute('title', 'Sticky note – or double-click the board');
  });

  it('NoteToolbar: six named swatches with aria-pressed and a Delete note button', async () => {
    const onColor = vi.fn();
    const onDelete = vi.fn();
    render(<NoteToolbar color="green" onColor={onColor} onDelete={onDelete} />);
    for (const name of COLOURS) {
      const swatch = screen.getByRole('button', { name: `${name} colour` });
      expect(swatch).toHaveAttribute('title', `${name} colour`);
      expect(swatch).toHaveAttribute('aria-pressed', name === 'Green' ? 'true' : 'false');
    }
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Violet colour' }));
    expect(onColor).toHaveBeenCalledWith('violet');
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('TC-27 Pink swatch recolours the note and keeps text, position and selection', () => {
    const { doc, id } = selectedBoard();
    const before = model(doc, id)!;
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Pink colour' }), { pointerId: 1, button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));
    expect(model(doc, id)).toEqual({ ...before, color: 'pink' });
    expect(noteEl(id)).toHaveAttribute('data-selected', 'true');
    expect(noteEl(id).style.backgroundColor).toBe('rgb(244, 143, 177)'); // #F48FB1
    expect(screen.getByRole('button', { name: 'Pink colour' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-28 Sticky note button creates one note centred on the viewport centre, editing', () => {
    const { doc } = renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    expect(notes()).toHaveLength(1);
    const id = notes()[0]!.dataset.id!;
    const centre = screenToWorld(resetCamera({ width: window.innerWidth, height: window.innerHeight }), {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    expect(model(doc, id)).toMatchObject({ x: centre.x - HALF, y: centre.y - HALF, color: 'yellow', text: '' });
    expect(editor()).toHaveFocus();
  });

  it('Sticky note button after panning creates the note in the middle of the new view, on top', () => {
    const doc = new Y.Doc();
    const existing = createSticky(doc, { x: 0, y: 0 });
    renderBoard(doc);
    const wheel = new WheelEvent('wheel', { deltaX: 5000, deltaY: -3000, bubbles: true, cancelable: true });
    screen.getByTestId('board-viewport').dispatchEvent(wheel);
    flushFrame();
    const camera = readCamera();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const id = notes().map((n) => n.dataset.id!).find((n) => n !== existing)!;
    const centre = screenToWorld(camera, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    expect(model(doc, id)?.x).toBeCloseTo(centre.x - HALF, 9);
    expect(model(doc, id)?.y).toBeCloseTo(centre.y - HALF, 9);
    expect(model(doc, id)!.z).toBeGreaterThan(model(doc, existing)!.z);
  });

  it('TC-29 bin button removes the note and clears the selection', () => {
    const { doc, id } = selectedBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(model(doc, id)).toBeUndefined();
    expect(notes()).toHaveLength(0);
    expect(screen.queryByRole('toolbar', { name: 'Note' })).toBeNull();
  });

  it('clicking a toolbar never reaches the board (selection kept)', () => {
    const { id } = selectedBoard();
    const swatch = screen.getByRole('button', { name: 'Blue colour' });
    fireEvent.pointerDown(swatch, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(swatch, { pointerId: 1, button: 0 });
    expect(noteEl(id)).toHaveAttribute('data-selected', 'true');
    const create = screen.getByRole('button', { name: 'Sticky note' });
    fireEvent.pointerDown(create, { pointerId: 1, button: 0 });
    expect(screen.getByTestId('board-viewport')).toHaveAttribute('data-state', 'idle');
  });
});
