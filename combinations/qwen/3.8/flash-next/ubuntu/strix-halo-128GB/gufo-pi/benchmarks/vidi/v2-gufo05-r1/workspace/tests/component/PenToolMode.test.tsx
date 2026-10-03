/**
 * The Pen as a board mode (story 11), on the real App.
 *
 * The isolated PenTool tests cover the gesture; these cover the mode around it — that drawing a
 * stroke leaves the Pen armed (unlike Shape and Connector, which hand back to Select), that
 * Escape and `v` put the tool away without drawing, and that changing the ink after a stroke
 * leaves the stroke already on the board alone.
 *
 * TC-09 drawing a stroke leaves the Pen armed and writes one stroke
 * TC-13 Escape, then `v` → Select, nothing created (negative)
 * TC-14 changing the colour after a stroke exists leaves it unchanged; the next stroke is new
 */
import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { objectSnapshots, type ObjectSnapshot } from '../../src/shared/board-model';
import { advanceFrames, renderStickyApp, type StickyAppHandle } from './stickyHarness';

const pressed = (name: string) =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed') === 'true';

function strokesOf(doc: Parameters<typeof objectSnapshots>[0]): (ObjectSnapshot & { color: string })[] {
  // The stroke snapshot type is structural; read it as a plain record of colour.
  return objectSnapshots(doc)
    .filter((o) => o.type === 'stroke')
    .map((o) => o as ObjectSnapshot & { color: string });
}

async function drawStrokeOn(board: StickyAppHandle, from: [number, number], to: [number, number]) {
  const overlay = screen.getByTestId('pen-tool');
  await board.press(overlay, from[0], from[1]);
  await board.moveTo(to[0], to[1]);
  await board.moveTo(to[0] + 5, to[1] + 5);
  await board.release(to[0] + 5, to[1] + 5);
  await advanceFrames();
}

describe('pen.tool_ui: the Pen as a mode (story 11)', () => {
  it('TC-09 drawing a stroke leaves the Pen armed and writes one stroke', async () => {
    const board = await renderStickyApp();
    await board.setCamera({ x: 0, y: 0, zoom: 1 });
    await board.pressKey('p');
    expect(pressed('Pen (P)')).toBe(true);

    await drawStrokeOn(board, [100, 100], [220, 160]);

    expect(strokesOf(board.doc)).toHaveLength(1);
    // The Pen stays armed for the next line — it does not return to Select.
    expect(pressed('Pen (P)')).toBe(true);
    expect(pressed('Select (V)')).toBe(false);

    // A second line is drawn immediately, so the mode really is still the Pen.
    await drawStrokeOn(board, [300, 300], [420, 360]);
    expect(strokesOf(board.doc)).toHaveLength(2);
  });

  it('TC-13 Escape then v puts the tool away and creates nothing (negative)', async () => {
    const board = await renderStickyApp();
    await board.pressKey('p');
    expect(pressed('Pen (P)')).toBe(true);

    await board.pressKey('Escape');
    expect(pressed('Pen (P)')).toBe(false);
    expect(pressed('Select (V)')).toBe(true);
    expect(strokesOf(board.doc)).toHaveLength(0);

    await board.pressKey('v');
    expect(pressed('Select (V)')).toBe(true);
    expect(strokesOf(board.doc)).toHaveLength(0);
  });

  it('TC-14 changing the colour leaves the existing stroke and recolours only the next', async () => {
    const board = await renderStickyApp();
    await board.setCamera({ x: 0, y: 0, zoom: 1 });
    await board.pressKey('p');

    // The first stroke takes the default ink.
    await drawStrokeOn(board, [80, 80], [200, 140]);
    const firstColor = strokesOf(board.doc)[0]!.color;

    // Choose blue, then draw again.
    await act(async () => {
      screen.getByRole('button', { name: 'Blue pen' }).click();
    });
    await advanceFrames();
    await drawStrokeOn(board, [300, 300], [420, 360]);

    const strokes = strokesOf(board.doc);
    expect(strokes).toHaveLength(2);
    expect(strokes[0]!.color).toBe(firstColor); // unchanged
    expect(strokes[1]!.color).toBe('blue'); // the new choice
  });
});
