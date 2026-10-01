import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { StrokeSnap } from '../../src/shared/objects/stroke';
import { STROKE_MAX_POINTS } from '../../src/shared/config';
import { down, key, move, objectsOf, pressed, renderBoard, up } from './shapes-helpers';

afterEach(cleanup);

const layer = () => screen.getByTestId('pen-tool-layer');
const strokes = (doc: Parameters<typeof objectsOf>[0]) => objectsOf(doc, 'stroke') as StrokeSnap[];

function drawLine(x0: number, y0: number, x1: number, y1: number, steps = 8) {
  down(layer(), x0, y0);
  for (let i = 1; i <= steps; i++) move(layer(), x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps + (i % 2) * 20);
}

describe('pen.tool', () => {
  it('TC-09 drag with red + thick commits one stroke in that style and the pen stays active', () => {
    const { doc } = renderBoard();
    key('p');
    expect(pressed('Pen (P)')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'red pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thick' }));
    drawLine(100, 100, 300, 160);
    expect(strokes(doc)).toHaveLength(0);
    up(layer(), 300, 160);
    const s = strokes(doc);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ color: 'red', thickness: 'thick' });
    expect(pressed('Pen (P)')).toBe('true');
    expect(screen.getByRole('group', { name: 'Drawing' })).toBeTruthy();
  });

  it('shows a local preview while dragging that is not in the document', async () => {
    const { doc } = renderBoard();
    key('p');
    drawLine(100, 100, 300, 160);
    expect(await screen.findByTestId('pen-preview')).toBeTruthy();
    expect(strokes(doc)).toHaveLength(0);
    up(layer(), 300, 160);
    expect(screen.queryByTestId('pen-preview')).toBeNull();
  });

  it('TC-10 a click without movement commits a single point', () => {
    const { doc } = renderBoard();
    key('p');
    down(layer(), 200, 200);
    up(layer(), 200, 200);
    const s = strokes(doc);
    expect(s).toHaveLength(1);
    expect(s[0].points).toHaveLength(2);
    expect(s[0].width).toBe(4);
  });

  it('TC-11 pointercancel keeps the stroke so far', () => {
    const { doc } = renderBoard();
    key('p');
    drawLine(100, 100, 300, 160);
    fireEvent.pointerCancel(layer(), { pointerId: 1 });
    expect(strokes(doc)).toHaveLength(1);
    expect(strokes(doc)[0].points.length).toBeGreaterThanOrEqual(4);
  });

  it('TC-12 STROKE_MAX_POINTS + 10 moves commit two strokes that join at the same point', () => {
    const { doc } = renderBoard();
    key('p');
    down(layer(), 10, 10);
    for (let i = 1; i <= STROKE_MAX_POINTS + 10; i++) move(layer(), 10 + (i % 700), 10 + (i % 13) * 4 + Math.floor(i / 700));
    up(layer(), 10, 10);
    const s = strokes(doc).sort((a, b) => a.z - b.z);
    expect(s).toHaveLength(2);
    // Simplification keeps first and last points, so the second part starts where the first ended.
    const lastOfFirst = { x: s[0].x + s[0].points[s[0].points.length - 2], y: s[0].y + s[0].points[s[0].points.length - 1] };
    const firstOfSecond = { x: s[1].x + s[1].points[0], y: s[1].y + s[1].points[1] };
    expect(firstOfSecond.x).toBeCloseTo(lastOfFirst.x, 6);
    expect(firstOfSecond.y).toBeCloseTo(lastOfFirst.y, 6);
  }, 30_000);

  it('TC-13 Escape and V switch to Select and create no stroke', () => {
    const { doc } = renderBoard();
    key('p');
    key('Escape');
    expect(pressed('Select (V)')).toBe('true');
    key('p');
    key('v');
    expect(pressed('Select (V)')).toBe('true');
    expect(screen.queryByTestId('pen-tool-layer')).toBeNull();
    expect(strokes(doc)).toHaveLength(0);
  });

  it('TC-14 changing the colour leaves existing strokes alone and applies to the next one', () => {
    const { doc } = renderBoard();
    key('p');
    drawLine(100, 100, 300, 160);
    up(layer(), 300, 160);
    fireEvent.click(screen.getByRole('button', { name: 'green pen' }));
    expect(screen.getByRole('button', { name: 'green pen' }).getAttribute('aria-pressed')).toBe('true');
    expect(strokes(doc)[0].color).toBe('black');
    drawLine(100, 300, 300, 360);
    up(layer(), 300, 360);
    expect(strokes(doc).map((s) => s.color).sort()).toEqual(['black', 'green']);
  });

  it('a drag starting on an existing object does not move it', () => {
    const { doc, ids } = renderBoard([{ x: 0, y: 0 }]);
    key('p');
    const before = objectsOf(doc, 'shape')[0];
    act(() => {});
    drawLine(40, 40, 140, 140);
    up(layer(), 140, 140);
    expect(objectsOf(doc, 'shape')[0]).toMatchObject({ id: ids[0], x: before.x, y: before.y });
    expect(strokes(doc)).toHaveLength(1);
  });
});
