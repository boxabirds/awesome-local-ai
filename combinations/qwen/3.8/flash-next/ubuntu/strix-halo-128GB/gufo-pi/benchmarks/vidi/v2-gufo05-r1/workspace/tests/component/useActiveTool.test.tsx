/**
 * The active tool and its return to Select (`tools.active_tool`).
 *
 * A tool is a mode, so this is about the state after each action: which button reads as
 * armed, whether creating hands the pointer back, and whether Escape abandons an armed
 * tool without writing anything — including from the middle of a drag.
 *
 * TC-22 S then create → Select; L then create → Select; S then Escape and L then Escape →
 *      Select and nothing created (negative)
 */
import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { objectSnapshots } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import { renderStickyApp, advanceFrames, type StickyAppHandle } from './stickyHarness';

const shapeButton = () => screen.getByRole('button', { name: 'Shape (S)' });
const connectorButton = () => screen.getByRole('button', { name: 'Connector (L)' });
const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });
const pressed = (b: HTMLElement) => b.getAttribute('aria-pressed') === 'true';

function countType(doc: Y.Doc, type: string): number {
  return objectSnapshots(doc).filter((o) => o.type === type).length;
}

async function addShape(board: StickyAppHandle, x: number, y: number): Promise<string> {
  let id = '';
  await act(async () => {
    id = createShape(board.doc, { kind: 'rect', rect: { x, y, width: 100, height: 100 }, at: { x, y } }, 'alex')!;
  });
  await advanceFrames();
  return id;
}

describe('tools.active_tool: creating hands the pointer back to Select', () => {
  it('TC-22 the Shape tool draws a shape, then Select is armed', async () => {
    const board = await renderStickyApp();
    await board.setCamera({ x: 0, y: 0, zoom: 1 });

    await board.pressKey('s');
    expect(pressed(shapeButton())).toBe(true);

    const overlay = screen.getByTestId('shape-tool');
    await board.press(overlay, 100, 100);
    await board.moveTo(260, 260);
    await board.release(260, 260);
    await advanceFrames();

    expect(countType(board.doc, 'shape')).toBe(1);
    expect(pressed(shapeButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
  });

  it('TC-22 the Connector tool draws an arrow, then Select is armed', async () => {
    const board = await renderStickyApp();
    await board.setCamera({ x: 0, y: 0, zoom: 1 });
    const a = await addShape(board, 100, 200);
    await addShape(board, 500, 200);

    await board.pressKey('l');
    expect(pressed(connectorButton())).toBe(true);

    const dot = screen
      .getAllByTestId('connector-dot')
      .find((d) => d.getAttribute('data-object-id') === a && d.getAttribute('data-side') === 'right')!;
    await board.press(dot, 200, 250);
    await board.moveTo(550, 250);
    await board.release(550, 250);
    await advanceFrames();

    expect(countType(board.doc, 'connector')).toBe(1);
    expect(pressed(connectorButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
  });
});

describe('tools.active_tool: Escape puts the tool away without creating', () => {
  it('TC-22 S then Escape → Select, nothing created', async () => {
    const board = await renderStickyApp();
    await board.pressKey('s');
    expect(pressed(shapeButton())).toBe(true);
    await board.pressKey('Escape');
    expect(pressed(shapeButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
    expect(countType(board.doc, 'shape')).toBe(0);
  });

  it('TC-22 L then Escape mid-drag → Select, nothing created (negative)', async () => {
    const board = await renderStickyApp();
    await board.setCamera({ x: 0, y: 0, zoom: 1 });
    const a = await addShape(board, 100, 200);

    await board.pressKey('l');
    const dot = screen.getAllByTestId('connector-dot').find((d) => d.getAttribute('data-object-id') === a)!;
    // Start a drag, then abandon it with Escape before releasing.
    await board.press(dot, 200, 250);
    await board.pressKey('Escape');
    await board.cancel();
    await advanceFrames();

    expect(pressed(connectorButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
    expect(countType(board.doc, 'connector')).toBe(0);
  });
});
