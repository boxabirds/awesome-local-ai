/**
 * The Shape tool, the shape object and its toolbar (`shape.ui`).
 *
 * These mount the real `App`, arm the Shape tool, and drive it with the pointer and
 * keyboard the way a person does. The camera is parked at `(0, 0, 1)` so a screen point
 * and a world point are the same number — the only way to read "the shape is where I
 * dragged" straight off the model.
 *
 * TC-15 S tool: drag shows a preview, creates exactly one shape, and selects it
 * TC-16 double-click opens the label; typing past the limit keeps `SHAPE_LABEL_MAX_CHARS` (boundary)
 * TC-17 clicking fill and outline swatches recolours, and touches nothing else
 * TC-28 a Shape-tool drag that starts on a sticky note does not move the note (negative)
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { objectSnapshots } from '../../src/shared/board-model';
import { createShape, type ShapeSnapshot } from '../../src/shared/objects/shape';
import { SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import {
  renderStickyApp,
  advanceFrames,
  type StickyAppHandle,
} from './stickyHarness';

const shapeButton = () => screen.getByRole('button', { name: 'Shape (S)' });
const pressed = (button: HTMLElement) => button.getAttribute('aria-pressed') === 'true';

function shapesOf(doc: Y.Doc): ShapeSnapshot[] {
  return objectSnapshots(doc).filter((o) => o.type === 'shape') as ShapeSnapshot[];
}

/** A shape at a known world rectangle, so tests can point at it. */
async function addShape(board: StickyAppHandle, x: number, y: number, w = 100, h = 100): Promise<string> {
  let id = '';
  await act(async () => {
    id = createShape(board.doc, { kind: 'rect', rect: { x, y, width: w, height: h }, at: { x, y } }, 'alex')!;
  });
  await advanceFrames();
  return id;
}

async function park(board: StickyAppHandle): Promise<void> {
  await board.setCamera({ x: 0, y: 0, zoom: 1 });
}

describe('shape.ui: the Shape tool draws a shape', () => {
  it('TC-15 a drag previews, creates one shape of the dragged size, and selects it', async () => {
    const board = await renderStickyApp();
    await park(board);

    await board.pressKey('s');
    expect(pressed(shapeButton())).toBe(true);
    const overlay = screen.getByTestId('shape-tool');

    // Press and drag: the ghost is on screen before anything is written.
    await board.press(overlay, 100, 100);
    await board.moveTo(300, 220);
    expect(screen.queryByTestId('shape-ghost')).toBeTruthy();
    expect(shapesOf(board.doc)).toHaveLength(0);

    await board.release(300, 220);
    await advanceFrames();

    const created = shapesOf(board.doc);
    expect(created).toHaveLength(1);
    // At camera (0,0,1) screen equals world: a drag (100,100)→(300,220) is a 200×120 box.
    expect(created[0]!.x).toBeCloseTo(100, 3);
    expect(created[0]!.y).toBeCloseTo(100, 3);
    expect(created[0]!.width).toBeCloseTo(200, 3);
    expect(created[0]!.height).toBeCloseTo(120, 3);
    // It came back to Select, holding the new shape (`tools.return_to_select`).
    expect(pressed(shapeButton())).toBe(false);
    expect(board.selectedIds()).toContain(created[0]!.id);
  });

  it('a click (no drag) makes the standard square centred on the point', async () => {
    const board = await renderStickyApp();
    await park(board);
    await board.pressKey('s');
    const overlay = screen.getByTestId('shape-tool');
    await board.press(overlay, 400, 300);
    await board.release(400, 300);
    await advanceFrames();
    const created = shapesOf(board.doc);
    expect(created).toHaveLength(1);
    expect(created[0]!.width).toBeCloseTo(160, 3);
    expect(created[0]!.x).toBeCloseTo(400 - 80, 3);
    expect(created[0]!.y).toBeCloseTo(300 - 80, 3);
  });

  it('TC-28 a drag that starts on a sticky note does not move the note', async () => {
    const board = await renderStickyApp();
    await park(board);
    const noteId = await board.addNote({ x: 400, y: 300 });
    const before = board.notes().find((n) => n.id === noteId)!;
    const bx = before.x;
    const by = before.y;

    await board.pressKey('s');
    const overlay = screen.getByTestId('shape-tool');
    // The press lands on top of where the note is; the tool owns the gesture.
    await board.press(overlay, 360, 260);
    await board.moveTo(440, 340);
    await board.release(440, 340);
    await advanceFrames();

    const after = board.notes().find((n) => n.id === noteId)!;
    expect(after.x).toBe(bx);
    expect(after.y).toBe(by);
    // The gesture drew a shape instead.
    expect(shapesOf(board.doc)).toHaveLength(1);
  });
});

describe('shape.ui: the label', () => {
  it('TC-16 double-click opens the label editor, and typing past the limit is clipped', async () => {
    const board = await renderStickyApp();
    await park(board);
    const id = await addShape(board, 100, 100, 200, 120);
    const element = screen.getByTestId('shape-object');

    await board.doubleClick(element, 150, 150);
    await advanceFrames();

    const editor = screen.getByTestId('shape-label-editor');
    expect(editor).toBeTruthy();

    // Type 600 characters the way a user does; the field clamps to the model's limit.
    const long = 'x'.repeat(SHAPE_LABEL_MAX_CHARS + 100);
    await act(async () => {
      editor.textContent = long;
      fireEvent.input(editor);
    });
    await advanceFrames();

    const shape = shapesOf(board.doc).find((s) => s.id === id)!;
    expect(shape.label.length).toBe(SHAPE_LABEL_MAX_CHARS);
  });
});

describe('shape.ui: colouring a shape', () => {
  it('TC-17 fill and outline swatches recolour, leaving label and selection alone', async () => {
    const board = await renderStickyApp();
    await park(board);
    const id = await addShape(board, 100, 100);

    // Select the shape: its toolbar appears.
    const element = screen.getByTestId('shape-object');
    await board.press(element, 150, 150);
    await board.release(150, 150);
    await advanceFrames();
    expect(screen.getByTestId('shape-toolbar')).toBeTruthy();

    await act(async () => {
      screen.getByRole('button', { name: 'Blue fill' }).click();
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Red outline' }).click();
    });
    await advanceFrames();

    const shape = shapesOf(board.doc).find((s) => s.id === id)!;
    expect(shape.fill).toBe('blue');
    expect(shape.stroke).toBe('red');
    // The size and position are exactly as drawn.
    expect(shape.width).toBeCloseTo(100, 3);
    expect(shape.x).toBeCloseTo(100, 3);
    // And it is still the selected object.
    expect(board.selectedIds()).toContain(id);
  });
});
