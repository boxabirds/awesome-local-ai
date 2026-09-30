import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { initDoc, objectsSnapshot } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { type StrokeSnap, isStroke, scaledPoints } from '../../src/shared/objects/stroke';
import { handwrittenLoop } from '../fixtures/pen-paths';
import { flushFrame, pointer } from './helpers';

function setup(camera = { x: 0, y: 0, zoom: 1 }) {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  const doc = new Y.Doc();
  initDoc(doc);
  render(<App doc={doc} />);
  act(() => window.__vidi6?.setCamera(camera));
  flushFrame();
  return doc;
}

const strokes = (doc: Y.Doc) => objectsSnapshot(doc).filter(isStroke) as StrokeSnap[];
const layer = () => screen.getByTestId('pen-tool');
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
const key = (k: string) => fireEvent.keyDown(window, { key: k });
const preview = () => screen.queryByTestId('pen-preview');

/** Presses at the first point, moves through the rest and releases at the last. */
function draw(points: { x: number; y: number }[]) {
  pointer(layer(), 'down', points[0]!.x, points[0]!.y);
  for (const p of points.slice(1)) pointer(layer(), 'move', p.x, p.y);
  pointer(layer(), 'up', points.at(-1)!.x, points.at(-1)!.y);
}

describe('pen.tool', () => {
  it('P shows the pen toolbar (black and Medium selected) and a round cursor sized to the thickness', () => {
    setup({ x: 0, y: 0, zoom: 2 });
    expect(screen.queryByRole('toolbar', { name: 'Pen' })).toBeNull();
    key('p');
    expect(pressed('Pen (P)')).toBe('true');
    const bar = screen.getByRole('toolbar', { name: 'Pen' });
    for (const name of ['Black pen', 'Blue pen', 'Red pen', 'Green pen', 'Orange pen', 'Purple pen', 'Thin', 'Medium', 'Thick']) {
      expect(bar.querySelector(`button[aria-label="${name}"]`)).toBeTruthy();
    }
    expect(pressed('Black pen')).toBe('true');
    expect(pressed('Medium')).toBe('true');
    expect(pressed('Thin')).toBe('false');
    fireEvent.pointerMove(layer(), { clientX: 300, clientY: 200, pointerId: 1 });
    const cursor = screen.getByTestId('pen-cursor');
    expect(cursor.style.width).toBe(`${PEN_THICKNESS_WORLD.medium * 2}px`);
    expect(cursor.style.height).toBe(`${PEN_THICKNESS_WORLD.medium * 2}px`);
  });

  it('TC-09 red + Thick, a drag → one red thick stroke; the preview updates per frame; the Pen stays active', () => {
    const doc = setup();
    key('p');
    fireEvent.click(screen.getByRole('button', { name: 'Red pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thick' }));
    expect(pressed('Red pen')).toBe('true');
    expect(pressed('Thick')).toBe('true');
    let updates = 0;
    doc.on('update', () => updates++);
    pointer(layer(), 'down', 100, 100);
    pointer(layer(), 'move', 150, 120);
    flushFrame();
    const first = preview()!.getAttribute('d');
    expect(first).toMatch(/^M /);
    pointer(layer(), 'move', 200, 180);
    pointer(layer(), 'move', 260, 150);
    flushFrame();
    expect(preview()!.getAttribute('d')).not.toBe(first);
    // Nothing is in the document (so nothing is shared) while the stroke is drawn.
    expect(updates).toBe(0);
    pointer(layer(), 'up', 300, 100);
    expect(updates).toBe(1);
    const [s] = strokes(doc);
    expect(strokes(doc)).toHaveLength(1);
    expect(s).toMatchObject({ color: 'red', thickness: 'thick' });
    expect(scaledPoints(s!)[0]).toEqual({ x: 100, y: 100 });
    expect(scaledPoints(s!).at(-1)).toEqual({ x: 300, y: 100 });
    expect(preview()).toBeNull();
    expect(pressed('Pen (P)')).toBe('true');
    expect(screen.getByTestId('pen-tool')).toBeTruthy();
    expect(window.__vidi6?.getSelection?.()).toEqual([]);
    // One finished stroke is one undo step.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(strokes(doc)).toHaveLength(0);
  });

  it('TC-10 press and release without moving → a dot whose diameter is the thickness', () => {
    const doc = setup();
    key('p');
    pointer(layer(), 'down', 240, 160);
    pointer(layer(), 'move', 241, 161);
    pointer(layer(), 'up', 241, 161);
    const [s] = strokes(doc);
    expect(s!.points).toHaveLength(2);
    expect(scaledPoints(s!)).toEqual([{ x: 240, y: 160 }]);
    expect(s!.width).toBe(PEN_THICKNESS_WORLD.medium);
    expect(s!.height).toBe(PEN_THICKNESS_WORLD.medium);
  });

  it('TC-11 pointer cancelled mid-drag → the stroke so far is kept', () => {
    const doc = setup();
    key('p');
    pointer(layer(), 'down', 100, 100);
    pointer(layer(), 'move', 150, 150);
    pointer(layer(), 'move', 200, 120);
    pointer(layer(), 'cancel', 500, 500);
    const [s] = strokes(doc);
    expect(strokes(doc)).toHaveLength(1);
    expect(scaledPoints(s!)[0]).toEqual({ x: 100, y: 100 });
    expect(scaledPoints(s!).at(-1)).toEqual({ x: 200, y: 120 });
    expect(preview()).toBeNull();
    // Lost pointer capture finishes the same way.
    pointer(layer(), 'down', 300, 300);
    pointer(layer(), 'move', 360, 300);
    fireEvent.lostPointerCapture(layer(), { pointerId: 1 });
    expect(strokes(doc)).toHaveLength(2);
  });

  it('TC-12 STROKE_MAX_POINTS + 10 moves → two strokes; the second starts at the first one’s last point', () => {
    const doc = setup();
    key('p');
    const total = STROKE_MAX_POINTS + 10;
    const at = (i: number) => ({ x: 50 + (i % 1000) * 0.9, y: 50 + Math.floor(i / 1000) * 20 + (i % 2) });
    pointer(layer(), 'down', at(0).x, at(0).y);
    for (let i = 1; i <= total; i++) pointer(layer(), 'move', at(i).x, at(i).y);
    // The first part is committed as soon as the limit is reached, before release.
    expect(strokes(doc)).toHaveLength(1);
    pointer(layer(), 'up', at(total).x, at(total).y);
    const all = strokes(doc).sort((a, b) => a.z - b.z);
    expect(all).toHaveLength(2);
    const firstEnd = scaledPoints(all[0]!).at(-1)!;
    const secondStart = scaledPoints(all[1]!)[0]!;
    expect(secondStart.x).toBeCloseTo(firstEnd.x, 6);
    expect(secondStart.y).toBeCloseTo(firstEnd.y, 6);
    expect(firstEnd).not.toEqual(at(0));
    const last = scaledPoints(all[1]!).at(-1)!;
    expect(last.x).toBeCloseTo(at(total).x, 6);
    expect(last.y).toBeCloseTo(at(total).y, 6);
  });

  it('TC-13 Escape mid-drag → Select, nothing created; V switches to Select too', () => {
    const doc = setup();
    key('p');
    pointer(layer(), 'down', 100, 100);
    pointer(layer(), 'move', 200, 200);
    key('Escape');
    expect(pressed('Select (V)')).toBe('true');
    expect(screen.queryByTestId('pen-tool')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Pen' })).toBeNull();
    key('p');
    expect(pressed('Pen (P)')).toBe('true');
    key('v');
    expect(pressed('Select (V)')).toBe('true');
    expect(strokes(doc)).toHaveLength(0);
    // The Pen button works too.
    fireEvent.click(screen.getByRole('button', { name: 'Pen (P)' }));
    expect(pressed('Pen (P)')).toBe('true');
  });

  it('TC-14 changing colour restyles nothing already drawn; the next stroke uses the new colour; choices outlive the tool', () => {
    const doc = setup();
    key('p');
    draw([
      { x: 100, y: 100 },
      { x: 200, y: 150 },
    ]);
    const [first] = strokes(doc);
    expect(first!.color).toBe('black');
    fireEvent.click(screen.getByRole('button', { name: 'Blue pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thin' }));
    expect(strokes(doc)[0]).toMatchObject({ color: 'black', thickness: 'medium' });
    const line = document.querySelector(`[data-stroke-object][data-id="${first!.id}"] .stroke-line`)!;
    expect(line.getAttribute('stroke')).toBe('#212121');
    key('v');
    key('p');
    expect(pressed('Blue pen')).toBe('true');
    expect(pressed('Thin')).toBe('true');
    draw([
      { x: 300, y: 100 },
      { x: 400, y: 150 },
    ]);
    const second = strokes(doc).find((s) => s.id !== first!.id)!;
    expect(second).toMatchObject({ color: 'blue', thickness: 'thin' });
    expect(strokes(doc).find((s) => s.id === first!.id)).toMatchObject({ color: 'black', thickness: 'medium' });
  });

  it('pen.smooth at 200%: every drawn point lies within 1 screen px of the finished stroke', () => {
    const doc = setup({ x: 0, y: 0, zoom: 2 });
    key('p');
    const screenPts = handwrittenLoop(500, 350, 200, 140);
    draw(screenPts);
    const [s] = strokes(doc);
    const finished = scaledPoints(s!);
    expect(finished.length).toBeLessThan(screenPts.length);
    for (const p of screenPts) {
      const world = { x: p.x / 2, y: p.y / 2 };
      expect(distanceToPolyline(finished, world) * 2).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('a Pen press on an existing object never moves or selects it', () => {
    const doc = setup();
    const id = window.__vidi6!.seedNotes!([{ x: 100, y: 100 }])[0]!;
    key('p');
    draw([
      { x: 150, y: 150 },
      { x: 250, y: 250 },
    ]);
    const note = objectsSnapshot(doc).find((o) => o.id === id)!;
    expect(note).toMatchObject({ x: 100, y: 100 });
    expect(window.__vidi6?.getSelection?.()).toEqual([]);
    expect(strokes(doc)).toHaveLength(1);
  });
});
