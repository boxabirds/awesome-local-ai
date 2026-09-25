import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, objectSnapshot } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { HANDWRITTEN_LOOP, LONG_SPIRAL, translatePath } from '../fixtures/pen-paths';
import { countUpdates, key, nextFrame, pointer, renderApp, setCamera } from './helpers';

function freshDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const strokes = (doc: Y.Doc) =>
  (objectSnapshot(doc).filter((o) => o.type === 'stroke') as StrokeSnap[]).sort((a, b) => a.z - b.z);
const button = (name: string) => screen.getByRole('button', { name });
const surface = () => screen.getByTestId('pen-tool');
const click = (name: string) => act(() => button(name).click());

function startPen(doc: Y.Doc) {
  renderApp(doc);
  setCamera({ x: 0, y: 0, zoom: 1 });
  expect(key('p', document.body)).toBe(true);
  expect(button('Pen (P)')).toHaveAttribute('aria-pressed', 'true');
}

/** Presses at the first point, moves through the rest (all in one act) and optionally releases at the last. */
function drag(points: readonly { x: number; y: number }[], end: 'up' | 'cancel' | 'lost' | null = 'up') {
  const el = surface();
  const at = (p: { x: number; y: number }, buttons = 1) => ({ clientX: p.x, clientY: p.y, pointerId: 1, button: 0, buttons });
  act(() => {
    fireEvent.pointerDown(el, at(points[0]));
    for (const p of points.slice(1)) fireEvent.pointerMove(el, at(p));
  });
  const last = points[points.length - 1];
  act(() => {
    if (end === 'up') fireEvent.pointerUp(el, at(last, 0));
    if (end === 'cancel') fireEvent.pointerCancel(el, at(last, 0));
    if (end === 'lost') fireEvent(el, new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 1 }));
  });
}

describe('Pen tool and options (pen.tool)', () => {
  it('shows the pen toolbar with black and Medium selected, and a round cursor sized to the thickness', () => {
    const doc = freshDoc();
    renderApp(doc);
    expect(screen.queryByRole('toolbar', { name: 'Pen' })).toBeNull();
    act(() => button('Pen (P)').click());
    expect(screen.getByRole('toolbar', { name: 'Pen' })).toBeInTheDocument();
    for (const c of ['black', 'blue', 'red', 'green', 'orange', 'purple']) {
      expect(button(`${c} pen`)).toHaveAttribute('aria-pressed', String(c === 'black'));
    }
    expect(button('Thin')).toHaveAttribute('aria-pressed', 'false');
    expect(button('Medium')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Thick')).toHaveAttribute('aria-pressed', 'false');
    setCamera({ x: 0, y: 0, zoom: 2 });
    expect(screen.getByTestId('pen-cursor').style.width).toBe(`${PEN_THICKNESS_WORLD.medium * 2}px`);
  });

  it('TC-09 with red and Thick, a drag commits one red thick stroke on release; the Pen stays active', () => {
    const doc = freshDoc();
    startPen(doc);
    click('red pen');
    click('Thick');
    expect(button('red pen')).toHaveAttribute('aria-pressed', 'true');
    const path = translatePath(HANDWRITTEN_LOOP, { x: 400, y: 300 });
    const el = surface();
    pointer(el, 'down', path[0].x, path[0].y);
    for (const p of path.slice(1, 50)) pointer(el, 'move', p.x, p.y);
    // While drawing: a local preview only, nothing in the doc.
    nextFrame();
    const preview = screen.getByTestId('pen-preview');
    expect(preview.getAttribute('d')).toMatch(/^M /);
    expect(preview.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thick));
    expect(strokes(doc)).toHaveLength(0);
    let n = 0;
    act(() => {
      n = countUpdates(doc, () => {
        for (const p of path.slice(50)) fireEvent.pointerMove(el, { clientX: p.x, clientY: p.y, pointerId: 1, buttons: 1 });
        const last = path.at(-1)!;
        fireEvent.pointerUp(el, { clientX: last.x, clientY: last.y, pointerId: 1, button: 0 });
      });
    });
    expect(n).toBe(1);
    const [s] = strokes(doc);
    expect(strokes(doc)).toHaveLength(1);
    expect(s).toMatchObject({ color: 'red', thickness: 'thick' });
    // Simplified, but faithful to within 1 screen px.
    expect(s.points.length / 2).toBeLessThan(path.length);
    const pts = scaledPoints(s);
    expect(Math.max(...path.map((p) => distanceToPolyline(pts, p)))).toBeLessThanOrEqual(1 + 1e-9);
    expect(screen.queryByTestId('pen-preview')).toBeNull();
    expect(button('Pen (P)')).toHaveAttribute('aria-pressed', 'true');
    expect(surface()).toBeInTheDocument();
  });

  it('TC-10 a press and release without movement commits a single-point dot', () => {
    const doc = freshDoc();
    startPen(doc);
    pointer(surface(), 'down', 200, 150);
    pointer(surface(), 'move', 201, 151);
    pointer(surface(), 'up', 201, 151);
    const [s] = strokes(doc);
    expect(s.points).toHaveLength(2);
    expect(scaledPoints(s)).toEqual([{ x: 200, y: 150 }]);
    const t = PEN_THICKNESS_WORLD.medium;
    expect(s).toMatchObject({ width: t, height: t });
  });

  it('TC-11 a pointercancel or lost capture mid-drag commits the points drawn so far', () => {
    const doc = freshDoc();
    startPen(doc);
    drag([{ x: 100, y: 100 }, { x: 150, y: 120 }, { x: 200, y: 100 }], 'cancel');
    expect(strokes(doc)).toHaveLength(1);
    expect(scaledPoints(strokes(doc)[0])).toEqual([{ x: 100, y: 100 }, { x: 150, y: 120 }, { x: 200, y: 100 }]);
    drag([{ x: 100, y: 300 }, { x: 300, y: 300 }], 'lost');
    expect(strokes(doc)).toHaveLength(2);
    expect(scaledPoints(strokes(doc)[1])).toEqual([{ x: 100, y: 300 }, { x: 300, y: 300 }]);
    expect(button('Pen (P)')).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-12 a drag of STROKE_MAX_POINTS + 10 moves commits two strokes; the second starts at the first one\'s end', () => {
    const doc = freshDoc();
    startPen(doc);
    const path = translatePath(LONG_SPIRAL.slice(0, STROKE_MAX_POINTS + 11), { x: 600, y: 400 });
    // Press + STROKE_MAX_POINTS - 1 moves: the limit is reached while drawing and the first part is committed.
    drag(path.slice(0, STROKE_MAX_POINTS), null);
    expect(strokes(doc)).toHaveLength(1);
    expect(surface()).toHaveAttribute('data-state', 'drawing');
    const el = surface();
    act(() => {
      for (const p of path.slice(STROKE_MAX_POINTS)) fireEvent.pointerMove(el, { clientX: p.x, clientY: p.y, pointerId: 1, buttons: 1 });
      fireEvent.pointerUp(el, { clientX: path.at(-1)!.x, clientY: path.at(-1)!.y, pointerId: 1, button: 0 });
    });
    const [first, second] = strokes(doc);
    expect(strokes(doc)).toHaveLength(2);
    const a = scaledPoints(first);
    const b = scaledPoints(second);
    expect(a.at(-1)!.x).toBeCloseTo(path[STROKE_MAX_POINTS - 1].x, 9);
    expect(a.at(-1)!.y).toBeCloseTo(path[STROKE_MAX_POINTS - 1].y, 9);
    expect(b[0].x).toBeCloseTo(a.at(-1)!.x, 9);
    expect(b[0].y).toBeCloseTo(a.at(-1)!.y, 9);
    expect(b.at(-1)!.x).toBeCloseTo(path.at(-1)!.x, 9);
  });

  it('TC-13 Escape, or pressing V, returns to Select and creates nothing', () => {
    const doc = freshDoc();
    startPen(doc);
    key('Escape', document.body);
    expect(button('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('pen-tool')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Pen' })).toBeNull();
    key('p', document.body);
    expect(button('Pen (P)')).toHaveAttribute('aria-pressed', 'true');
    key('v', document.body);
    expect(button('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(objectSnapshot(doc)).toHaveLength(0);
  });

  it('TC-14 changing the colour restyles nothing already drawn; the next stroke and later sessions use it', () => {
    const doc = freshDoc();
    startPen(doc);
    drag([{ x: 100, y: 100 }, { x: 200, y: 100 }]);
    const [first] = strokes(doc);
    expect(first.color).toBe('black');
    let n = 0;
    act(() => {
      n = countUpdates(doc, () => {
        button('green pen').click();
        button('Thin').click();
      });
    });
    expect(n).toBe(0);
    expect(strokes(doc)[0]).toEqual(first);
    drag([{ x: 100, y: 200 }, { x: 200, y: 200 }]);
    expect(strokes(doc)[1]).toMatchObject({ color: 'green', thickness: 'thin' });
    expect(strokes(doc)[0]).toMatchObject({ color: 'black', thickness: 'medium' });
    // Remembered across tool changes (until reload).
    key('v', document.body);
    key('p', document.body);
    expect(button('green pen')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Thin')).toHaveAttribute('aria-pressed', 'true');
  });

  it('each finished stroke is its own undo step', () => {
    const doc = freshDoc();
    startPen(doc);
    drag([{ x: 100, y: 100 }, { x: 200, y: 100 }]);
    drag([{ x: 100, y: 200 }, { x: 200, y: 200 }]);
    expect(strokes(doc)).toHaveLength(2);
    act(() => button('Undo').click());
    expect(strokes(doc)).toHaveLength(1);
    expect(scaledPoints(strokes(doc)[0])[0]).toEqual({ x: 100, y: 100 });
  });
});
