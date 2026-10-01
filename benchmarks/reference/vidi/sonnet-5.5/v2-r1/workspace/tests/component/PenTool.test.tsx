import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { PenTool } from '../../src/client/tools/PenTool';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { STROKE_MAX_POINTS } from '../../src/shared/config';
import type { PenColor, PenThickness } from '../../src/shared/config';
import { scaledPoints } from '../../src/shared/objects/stroke';
import type { StrokeSnap } from '../../src/shared/objects/stroke';
import { key } from './shapeHelpers';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const layer = () => screen.getByTestId('pen-tool-layer');
const camera = { x: 0, y: 0, zoom: 1 };
const strokesOf = (doc: Y.Doc) => snapshot(doc).filter((o) => o.type === 'stroke') as unknown as StrokeSnap[];
const appStrokes = () => [...document.querySelectorAll('[data-stroke-object]')];
const down = (x: number, y: number) => fireEvent.pointerDown(layer(), { clientX: x, clientY: y, pointerId: 1, button: 0 });
const move = (x: number, y: number) => fireEvent.pointerMove(layer(), { clientX: x, clientY: y, pointerId: 1 });
const up = (x: number, y: number) => fireEvent.pointerUp(layer(), { clientX: x, clientY: y, pointerId: 1 });

function standalone(color: PenColor = 'red', thickness: PenThickness = 'thick') {
  const doc = new Y.Doc();
  initDoc(doc);
  render(<PenTool camera={camera} color={color} thickness={thickness} doc={doc} identityId="u" />);
  return doc;
}

describe('pen tool', () => {
  it('TC-09 a drag commits one stroke in the chosen colour and thickness and the pen stays active', () => {
    render(<App />);
    key('p');
    fireEvent.click(screen.getByRole('button', { name: 'red pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thick' }));
    expect(screen.getByRole('button', { name: 'red pen' }).getAttribute('aria-pressed')).toBe('true');
    down(100, 100);
    move(150, 140);
    move(200, 100);
    up(200, 100);
    expect(appStrokes()).toHaveLength(1);
    const path = screen.getByTestId('stroke-path');
    expect(path.getAttribute('stroke')).toBe('#E53935');
    expect(path.getAttribute('stroke-width')).toBe('8');
    expect(screen.getByRole('img', { name: 'Drawing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pen (P)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('pen-tool-layer')).toBeTruthy();
  });

  it('shows the pen toolbar only while the pen is active, black and medium selected', () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: 'black pen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pen (P)' }));
    expect(screen.getByRole('button', { name: 'black pen' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Medium' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('button', { name: /pen$/ }).filter((b) => b.className.includes('swatch'))).toHaveLength(6);
    for (const name of ['Thin', 'Thick']) expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('TC-10 a click without movement commits a single-point dot', () => {
    const doc = standalone();
    down(300, 200);
    up(300, 200);
    const [s] = strokesOf(doc);
    expect(strokesOf(doc)).toHaveLength(1);
    expect(s.points).toHaveLength(2);
    expect(s.width).toBe(8);
  });

  it('TC-11 pointercancel keeps the stroke drawn so far', () => {
    const doc = standalone();
    down(10, 10);
    move(60, 40);
    move(120, 10);
    fireEvent.pointerCancel(layer(), { pointerId: 1 });
    expect(strokesOf(doc)).toHaveLength(1);
    expect(scaledPoints(strokesOf(doc)[0]).length).toBeGreaterThanOrEqual(3);
  });

  it('losing the pointer capture also keeps the stroke, and a later pointerup adds nothing', () => {
    const doc = standalone();
    down(10, 10);
    move(60, 40);
    move(120, 10);
    fireEvent.lostPointerCapture(layer(), { pointerId: 1 });
    up(120, 10);
    expect(strokesOf(doc)).toHaveLength(1);
  });

  it('TC-12 reaching the point limit commits a part and continues from its last point', () => {
    const doc = standalone('blue', 'thin');
    down(0, 0);
    for (let i = 1; i <= STROKE_MAX_POINTS + 9; i++) move(i, (i % 2) * 30 + (i % 7) * 10);
    up(STROKE_MAX_POINTS + 9, 0);
    const strokes = strokesOf(doc);
    expect(strokes).toHaveLength(2);
    const first = scaledPoints(strokes[0]);
    const second = scaledPoints(strokes[1]);
    expect(second[0].x).toBeCloseTo(first[first.length - 1].x);
    expect(second[0].y).toBeCloseTo(first[first.length - 1].y);
  });

  it('exactly the limit does not leave a stray dot behind', () => {
    const doc = standalone('blue', 'thin');
    down(0, 0);
    for (let i = 1; i < STROKE_MAX_POINTS; i++) move(i, (i % 2) * 30 + (i % 7) * 10);
    up(0, 0);
    expect(strokesOf(doc)).toHaveLength(1);
  });

  it('draws a local preview that follows the drag once per frame and is removed afterwards', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const doc = standalone();
    down(10, 10);
    move(50, 50);
    act(() => void vi.advanceTimersByTime(20));
    const d1 = screen.getByTestId('pen-preview').getAttribute('d');
    move(90, 20);
    act(() => void vi.advanceTimersByTime(20));
    expect(screen.getByTestId('pen-preview').getAttribute('d')).not.toBe(d1);
    expect(strokesOf(doc)).toHaveLength(0);
    up(90, 20);
    expect(screen.queryByTestId('pen-preview')).toBeNull();
    expect(strokesOf(doc)).toHaveLength(1);
  });

  it('TC-13 Escape then V switch to Select and create nothing', () => {
    render(<App />);
    key('p');
    down(100, 100);
    key('Escape');
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('pen-tool-layer')).toBeNull();
    key('p');
    key('v');
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('true');
    expect(appStrokes()).toHaveLength(0);
  });

  it('TC-14 changing the colour restyles nothing already drawn', () => {
    render(<App />);
    key('p');
    down(100, 100);
    move(200, 150);
    up(200, 150);
    fireEvent.click(screen.getByRole('button', { name: 'green pen' }));
    expect(screen.getByTestId('stroke-path').getAttribute('stroke')).toBe('#212121');
    down(300, 300);
    move(400, 350);
    up(400, 350);
    const colours = screen.getAllByTestId('stroke-path').map((p) => p.getAttribute('stroke'));
    expect(colours.sort()).toEqual(['#212121', '#43A047']);
  });

  it('keeps the options when the tool is switched away and back', () => {
    function Probe() {
      const [n, setN] = useState(0);
      return <button onClick={() => setN(n + 1)}>{n}</button>;
    }
    render(<><App /><Probe /></>);
    key('p');
    fireEvent.click(screen.getByRole('button', { name: 'purple pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thin' }));
    key('Escape');
    key('p');
    expect(screen.getByRole('button', { name: 'purple pen' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Thin' }).getAttribute('aria-pressed')).toBe('true');
  });
});
