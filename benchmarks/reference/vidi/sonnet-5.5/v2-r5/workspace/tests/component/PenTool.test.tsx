import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { newDoc } from './helpers';

const hoisted = vi.hoisted(() => ({ doc: null as unknown as Y.Doc }));

vi.mock('../../src/client/board/useBoardDoc', async () => {
  const model = await import('../../src/shared/board-model');
  const react = await import('react');
  return {
    useBoardDoc: () => {
      const doc = hoisted.doc;
      const [objects, setObjects] = react.useState(() => model.snapshotObjects(doc));
      react.useEffect(() => {
        const map = doc.getMap('objects');
        const h = () => setObjects(model.snapshotObjects(doc));
        map.observeDeep(h);
        return () => map.unobserveDeep(h);
      }, [doc]);
      return { doc, objects, connection: 'connected' };
    },
  };
});

import { snapshotObjects } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';
import type { StrokeSnap } from '../../src/shared/objects/stroke';
import { App } from './TestApp';

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => { hoisted.doc = newDoc(); });

// jsdom viewport 1024 x 768; the initial camera puts the world origin at the centre.
const ORIGIN = { x: 512, y: 384 };
const strokes = () => snapshotObjects(hoisted.doc).filter((o): o is StrokeSnap => o.type === 'stroke');
const layer = () => screen.getByTestId('pen-tool-layer');
const ptr = (clientX: number, clientY: number) => ({ clientX, clientY, pointerId: 1, button: 0 });
const penButton = () => screen.getByRole('button', { name: 'Pen (P)' });

function drag(points: Array<[number, number]>, end: 'up' | 'cancel' | 'lost' = 'up') {
  const [first, ...rest] = points;
  fireEvent.pointerDown(layer(), ptr(first[0], first[1]));
  rest.forEach(([x, y]) => fireEvent.pointerMove(layer(), ptr(x, y)));
  const last = points[points.length - 1];
  if (end === 'up') fireEvent.pointerUp(layer(), ptr(last[0], last[1]));
  else if (end === 'cancel') fireEvent.pointerCancel(layer(), ptr(last[0], last[1]));
  else fireEvent.lostPointerCapture(layer(), ptr(last[0], last[1]));
}
const path = (n: number): Array<[number, number]> => Array.from({ length: n }, (_, i) => [100 + i * 20, 100 + (i % 2) * 40]);

describe('pen tool', () => {
  it('P and the toolbar button activate the pen; the pen toolbar shows six colours and three thicknesses', () => {
    render(<App />);
    expect(screen.queryByRole('toolbar', { name: 'Pen options' })).toBeNull();
    fireEvent.keyDown(window, { key: 'p' });
    expect(penButton().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'black pen' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('button', { name: /^(black|blue|red|green|orange|purple) pen$/ })).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Medium' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Thin' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thick' })).toBeTruthy();
  });

  it('TC-09 a drag with red + thick creates one stroke in that colour and thickness, and the pen stays active', () => {
    render(<App />);
    fireEvent.click(penButton());
    fireEvent.click(screen.getByRole('button', { name: 'red pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thick' }));
    drag([[100, 100], [150, 140], [200, 100], [250, 140]]);
    expect(strokes()).toHaveLength(1);
    expect(strokes()[0]).toMatchObject({ color: 'red', thickness: 'thick' });
    expect(penButton().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('pen-tool-layer')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Drawing' })).toBeTruthy();
  });

  it('the preview follows the pointer once per animation frame and is never written to the document', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    render(<App />);
    fireEvent.keyDown(window, { key: 'p' });
    fireEvent.pointerDown(layer(), ptr(100, 100));
    fireEvent.pointerMove(layer(), ptr(150, 140));
    act(() => { vi.advanceTimersByTime(20); });
    const first = screen.getByTestId('pen-preview').getAttribute('d');
    expect(first).toBeTruthy();
    fireEvent.pointerMove(layer(), ptr(220, 90));
    act(() => { vi.advanceTimersByTime(20); });
    expect(screen.getByTestId('pen-preview').getAttribute('d')).not.toBe(first);
    expect(strokes()).toHaveLength(0);
    fireEvent.pointerUp(layer(), ptr(220, 90));
    expect(strokes()).toHaveLength(1);
    expect(screen.queryByTestId('pen-preview')).toBeNull();
  });

  it('TC-10 a click without movement commits a single point whose diameter is the thickness', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'p' });
    drag([[300, 300], [301, 300]]);
    const [s] = strokes();
    expect(strokes()).toHaveLength(1);
    expect(s.points).toHaveLength(2);
    expect(s.width).toBe(PEN_THICKNESS_WORLD.medium);
    expect(s.x).toBe(300 - ORIGIN.x - PEN_THICKNESS_WORLD.medium / 2);
  });

  it('TC-11 pointercancel and lostpointercapture commit the stroke drawn so far', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'p' });
    drag([[100, 100], [160, 150], [220, 100]], 'cancel');
    expect(strokes()).toHaveLength(1);
    expect(strokes()[0].width).toBeGreaterThan(100);
    drag([[100, 300], [160, 350], [220, 300]], 'lost');
    expect(strokes()).toHaveLength(2);
    // The release after a cancel does not commit a second copy.
    fireEvent.pointerUp(layer(), ptr(220, 300));
    expect(strokes()).toHaveLength(2);
    expect(penButton().getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-12 STROKE_MAX_POINTS + 10 moves make two strokes; the second starts where the first ended', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'p' });
    const spiral: Array<[number, number]> = Array.from({ length: STROKE_MAX_POINTS + 11 }, (_, i) => [
      512 + Math.cos(i / 40) * (50 + i * 0.02), 384 + Math.sin(i / 40) * (50 + i * 0.02),
    ]);
    drag(spiral);
    const all = strokes();
    expect(all).toHaveLength(2);
    const endOf = (s: StrokeSnap) => ({ x: s.x + s.points[s.points.length - 2], y: s.y + s.points[s.points.length - 1] });
    const startOf = (s: StrokeSnap) => ({ x: s.x + s.points[0], y: s.y + s.points[1] });
    const [a, b] = all;
    expect(startOf(b).x).toBeCloseTo(endOf(a).x, 6);
    expect(startOf(b).y).toBeCloseTo(endOf(a).y, 6);
  });

  it('TC-13 Escape and V leave the pen without creating a stroke', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'p' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('pen-tool-layer')).toBeNull();
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(window, { key: 'p' });
    fireEvent.keyDown(window, { key: 'v' });
    expect(screen.queryByTestId('pen-tool-layer')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Pen options' })).toBeNull();
    expect(strokes()).toHaveLength(0);
  });

  it('TC-14 changing colour after a stroke exists leaves it alone; the next stroke uses the new colour', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'p' });
    drag(path(4));
    fireEvent.click(screen.getByRole('button', { name: 'green pen' }));
    expect(strokes()[0].color).toBe('black');
    drag(path(4).map(([x, y]) => [x, y + 200] as [number, number]));
    expect(strokes().map((s) => s.color)).toEqual(['black', 'green']);
  });

  it('colour and thickness survive switching tools within the session', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'p' });
    fireEvent.click(screen.getByRole('button', { name: 'purple pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thin' }));
    fireEvent.keyDown(window, { key: 'v' });
    fireEvent.keyDown(window, { key: 'p' });
    expect(screen.getByRole('button', { name: 'purple pen' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Thin' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('each finished stroke is one undo step', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'p' });
    drag(path(4));
    drag(path(4).map(([x, y]) => [x, y + 200] as [number, number]));
    expect(strokes()).toHaveLength(2);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(strokes()).toHaveLength(1);
  });
});
