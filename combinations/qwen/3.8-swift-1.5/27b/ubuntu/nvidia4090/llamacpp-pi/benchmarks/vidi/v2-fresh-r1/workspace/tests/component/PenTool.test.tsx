// Component tests for the Pen tool (pen.tool_ui contract): TC-09 to TC-14.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { BoardHarness, makeDoc } from './board-harness';
import './fake-raf';

function renderBoard(canEdit = true) {
  const doc = makeDoc();
  initDoc(doc);
  render(<BoardHarness doc={doc} canEdit={canEdit} withToolbar />);
  return { doc };
}

function strokeIds(doc: Y.Doc): string[] {
  return snapshot(doc).filter((o) => o.type === 'stroke').map((o) => o.id);
}

function strokeAt(doc: Y.Doc, index = 0): StrokeSnap {
  const strokes = snapshot(doc).filter((o) => o.type === 'stroke');
  return strokes[index] as StrokeSnap;
}

/** Activate the Pen tool via keyboard shortcut. */
function activatePen() {
  fireEvent.keyDown(window, { key: 'p' });
}

/** A short freehand drag on the pen overlay. */
function dragPen(points: Array<[number, number]>, up = true) {
  const pen = screen.getByTestId('pen-tool');
  const [sx, sy] = points[0];
  fireEvent.pointerDown(pen, { clientX: sx, clientY: sy, button: 0 });
  for (let i = 1; i < points.length; i++) {
    fireEvent.pointerMove(pen, { clientX: points[i][0], clientY: points[i][1] });
  }
  if (up) {
    const [ex, ey] = points[points.length - 1];
    fireEvent.pointerUp(pen, { clientX: ex, clientY: ey });
  }
}

afterEach(cleanup);

describe('Pen tool (story 11)', () => {
  // TC-09: P → Pen active; draw → one stroke in the doc with the chosen
  // colour/thickness; the tool stays Pen.
  test('TC-09 P activates Pen; drawing commits a stroke with the chosen style', () => {
    const { doc } = renderBoard();

    activatePen();
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('pen');
    expect(screen.getByTestId('pen-tool-btn').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('pen-toolbar')).toBeTruthy();

    // Choose red + thick.
    fireEvent.click(screen.getByTestId('pen-color-red'));
    fireEvent.click(screen.getByTestId('pen-thickness-thick'));

    dragPen([
      [600, 400],
      [650, 430],
      [700, 460],
    ]);

    expect(strokeIds(doc)).toHaveLength(1);
    const s = strokeAt(doc);
    expect(s.color).toBe('red');
    expect(s.thickness).toBe('thick');
    // The Pen tool stays active after a finished stroke.
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('pen');
  });

  // TC-10: click without movement → a dot: a stroke of a single point with
  // a thickness-square bbox.
  test('TC-10 a click without movement draws a dot', () => {
    const { doc } = renderBoard();

    activatePen();
    dragPen([[640, 400]]);

    expect(strokeIds(doc)).toHaveLength(1);
    const s = strokeAt(doc);
    expect(s.points).toHaveLength(2); // one flattened point
    expect(s.width).toBe(4); // medium thickness square
    expect(s.height).toBe(4);
    const pts = scaledPoints(s);
    expect(pts).toHaveLength(1);
    // The dot sits at the click point (world = screen - camera; camera centres origin).
    expect(pts[0].x).toBeCloseTo(0, 5);
    expect(pts[0].y).toBeCloseTo(0, 5);
  });

  // TC-11: pointercancel → the points drawn so far are kept as a stroke.
  test('TC-11 an interrupted stroke keeps the points drawn so far', () => {
    const { doc } = renderBoard();

    activatePen();
    const pen = screen.getByTestId('pen-tool');
    fireEvent.pointerDown(pen, { clientX: 600, clientY: 400, button: 0 });
    fireEvent.pointerMove(pen, { clientX: 640, clientY: 420 });
    fireEvent.pointerMove(pen, { clientX: 680, clientY: 440 });
    fireEvent.pointerCancel(pen, { clientX: 680, clientY: 440 });

    expect(strokeIds(doc)).toHaveLength(1);
    const s = strokeAt(doc);
    expect(scaledPoints(s).length).toBeGreaterThanOrEqual(2);
  });

  // TC-12: a stroke of 5,010 points splits into two strokes; the second
  // starts at the first's last point (no visible gap).
  test('TC-12 a 5010-point stroke splits at the limit and stays continuous', () => {
    const { doc } = renderBoard();

    activatePen();
    const pen = screen.getByTestId('pen-tool');
    fireEvent.pointerDown(pen, { clientX: 600, clientY: 400, button: 0 });
    // A wavy path: RDP keeps enough of it to verify the split boundary.
    for (let i = 1; i <= 5010; i++) {
      fireEvent.pointerMove(pen, { clientX: 600 + i * 0.1, clientY: 400 + i * 0.05 + Math.sin(i * 0.2) * 20 });
    }
    fireEvent.pointerUp(pen, { clientX: 600 + 5010 * 0.1, clientY: 400 + 5010 * 0.05 + Math.sin(5010 * 0.2) * 20 });

    expect(strokeIds(doc)).toHaveLength(2);
    const first = scaledPoints(strokeAt(doc, 0));
    const second = scaledPoints(strokeAt(doc, 1));
    expect(first.length).toBeGreaterThan(100);
    expect(first.length).toBeLessThanOrEqual(5000);
    expect(second.length).toBeGreaterThanOrEqual(2);
    // Continuity: the second stroke starts where the first ended.
    expect(second[0]).toEqual(first[first.length - 1]);
  });

  // TC-13: P → Pen; Escape → Select; V → Select (no stroke created).
  test('TC-13 Escape and V return to Select', () => {
    const { doc } = renderBoard();

    activatePen();
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('pen');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('select');
    expect(screen.queryByTestId('pen-tool')).toBeNull();

    activatePen();
    fireEvent.keyDown(window, { key: 'v' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('select');

    expect(strokeIds(doc)).toHaveLength(0);
  });

  // TC-14: changing colour affects later strokes only; existing strokes
  // keep their stored colour.
  test('TC-14 changing colour does not restyle existing strokes', () => {
    const { doc } = renderBoard();

    activatePen();
    dragPen([
      [560, 400],
      [620, 440],
    ]);
    const firstId = strokeIds(doc)[0];
    expect(strokeAt(doc, 0).color).toBe('black'); // default

    // Switch to green and draw again.
    fireEvent.click(screen.getByTestId('pen-color-green'));
    dragPen([
      [660, 300],
      [720, 340],
    ]);

    const all = snapshot(doc);
    const first = all.find((o) => o.id === firstId) as StrokeSnap;
    const second = strokeAt(doc, 1);
    expect(first.color).toBe('black');
    expect(second.color).toBe('green');
  });
});
