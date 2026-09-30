// pen.tool (TC-09 to TC-14): the Pen tool's gesture states, its toolbar and staying active.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';
import { createSticky, initDoc, objectsSnapshot } from '../../src/shared/board-model';
import { scaledPoints } from '../../src/shared/objects/stroke';
import { resetPenOptions } from '../../src/client/tools/usePenOptions';
import { LONG_SPIRAL, UNDERLINE } from '../fixtures/pen-paths';
import { dispatchKey, nextFrame, useFakeFrames } from './helpers';
import { drawWorld, isPressed, penButton, penTool, strokesOf } from './penHelpers';
import { resetCameraTracking, setCamera, toClient, toolButton } from './shapeHelpers';
import { renderApp } from './stickyHelpers';
import { countLocalWrites } from './textHelpers';
import * as Y from 'yjs';

beforeEach(() => {
  useFakeFrames();
  resetCameraTracking();
  resetPenOptions();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const underline = UNDERLINE.map((p) => ({ x: p.x - 150, y: p.y + 40 }));

describe('pen.tool drawing', () => {
  it('TC-09 red + Thick, drag: one stroke in red/thick; the Pen stays active', () => {
    const { doc } = renderApp();
    const writes = countLocalWrites(doc);
    dispatchKey({ key: 'p' });
    expect(isPressed(penButton())).toBe(true);
    // Pen toolbar: black and Medium chosen by default.
    expect(isPressed(toolButton('black pen'))).toBe(true);
    expect(isPressed(toolButton('Medium'))).toBe(true);
    fireEvent.click(toolButton('red pen'));
    fireEvent.click(toolButton('Thick'));
    expect(isPressed(toolButton('red pen'))).toBe(true);
    expect(isPressed(toolButton('black pen'))).toBe(false);
    expect(isPressed(toolButton('Thick'))).toBe(true);

    drawWorld(underline);
    const strokes = strokesOf(doc);
    expect(strokes).toHaveLength(1);
    expect(writes.n).toBe(1);
    expect(strokes[0]).toMatchObject({ color: 'red', thickness: 'thick' });
    // Simplified, yet faithful: starts and ends where the drag did.
    const pts = scaledPoints(strokes[0]);
    expect(pts.length).toBeLessThan(underline.length);
    expect(pts[0].x).toBeCloseTo(underline[0].x, 6);
    expect(pts.at(-1)!.y).toBeCloseTo(underline.at(-1)!.y, 6);
    expect(isPressed(penButton())).toBe(true);
    expect(screen.getByTestId('pen-tool')).toBeTruthy();

    // A second stroke right away.
    drawWorld(underline.map((p) => ({ x: p.x, y: p.y + 100 })));
    expect(strokesOf(doc)).toHaveLength(2);
    expect(isPressed(penButton())).toBe(true);
  });

  it('the preview follows the drag once per frame, is never written to the board, and goes on release', () => {
    const { doc } = renderApp();
    const writes = countLocalWrites(doc);
    fireEvent.click(penButton());
    const el = penTool();
    const c = underline.map(toClient);
    fireEvent.pointerDown(el, { clientX: c[0].x, clientY: c[0].y, button: 0, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: c[10].x, clientY: c[10].y, pointerId: 1 });
    nextFrame();
    const first = screen.getByTestId('pen-preview').getAttribute('d');
    expect(first).toMatch(/^M /);
    fireEvent.pointerMove(el, { clientX: c[40].x, clientY: c[40].y, pointerId: 1 });
    nextFrame();
    const second = screen.getByTestId('pen-preview').getAttribute('d');
    expect(second).not.toBe(first);
    expect(screen.getByTestId('pen-preview').getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.medium));
    // Nothing on the board (and so nothing sent to anyone) while drawing.
    expect(writes.n).toBe(0);
    expect(strokesOf(doc)).toHaveLength(0);
    fireEvent.pointerUp(el, { clientX: c[40].x, clientY: c[40].y, pointerId: 1 });
    expect(screen.queryByTestId('pen-preview')).toBeNull();
    expect(strokesOf(doc)).toHaveLength(1);
  });

  it('TC-10 a click without moving: a single-point dot whose diameter is the thickness', () => {
    const { doc } = renderApp();
    dispatchKey({ key: 'p' });
    fireEvent.click(toolButton('Thin'));
    const at = { x: 30, y: -20 };
    drawWorld([at]);
    const [dot] = strokesOf(doc);
    expect(dot.points).toHaveLength(2);
    const t = PEN_THICKNESS_WORLD.thin;
    expect(dot).toMatchObject({ x: at.x - t / 2, y: at.y - t / 2, width: t, height: t, thickness: 'thin' });
    // A tiny wobble below the drag threshold is still a click.
    const c = toClient({ x: 200, y: 200 });
    fireEvent.pointerDown(penTool(), { clientX: c.x, clientY: c.y, button: 0, pointerId: 1 });
    fireEvent.pointerMove(penTool(), { clientX: c.x + 1, clientY: c.y + 1, pointerId: 1 });
    fireEvent.pointerUp(penTool(), { clientX: c.x + 1, clientY: c.y + 1, pointerId: 1 });
    const dots = strokesOf(doc);
    expect(dots).toHaveLength(2);
    expect(dots[1].points).toHaveLength(2);
  });

  it('TC-11 an interrupted drag (pointercancel, lost capture) keeps the stroke drawn so far', () => {
    const { doc } = renderApp();
    dispatchKey({ key: 'p' });
    drawWorld(underline.slice(0, 60), { end: 'cancel' });
    let strokes = strokesOf(doc);
    expect(strokes).toHaveLength(1);
    const pts = scaledPoints(strokes[0]);
    expect(pts.at(-1)!.x).toBeCloseTo(underline[59].x, 6);
    expect(screen.queryByTestId('pen-preview')).toBeNull();

    drawWorld(underline.slice(0, 30).map((p) => ({ x: p.x, y: p.y + 200 })), { end: 'lost' });
    strokes = strokesOf(doc);
    expect(strokes).toHaveLength(2);
    expect(isPressed(penButton())).toBe(true);
  });

  it('TC-12 STROKE_MAX_POINTS + 10 moves: two strokes, the second starting at the first\'s last point; each is one undo step', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { getByRole } = renderApp(doc);
    dispatchKey({ key: 'p' });
    const spiral = LONG_SPIRAL.slice(0, STROKE_MAX_POINTS + 10);
    drawWorld([{ x: spiral[0].x - 1, y: spiral[0].y }, ...spiral]);
    const strokes = strokesOf(doc);
    expect(strokes).toHaveLength(2);
    const a = scaledPoints(strokes[0]);
    const b = scaledPoints(strokes[1]);
    expect(b[0].x).toBeCloseTo(a.at(-1)!.x, 6);
    expect(b[0].y).toBeCloseTo(a.at(-1)!.y, 6);
    expect(b.at(-1)!.x).toBeCloseTo(spiral.at(-1)!.x, 6);

    fireEvent.click(getByRole('button', { name: /^Undo/ }));
    expect(strokesOf(doc).map((s) => s.id)).toEqual([strokes[0].id]);
  });

  it('a Pen drag starting over a sticky note draws and leaves the note where it was', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    renderApp(doc);
    const before = objectsSnapshot(doc).find((o) => o.type === 'sticky')!;
    dispatchKey({ key: 'p' });
    drawWorld([{ x: 0, y: 0 }, { x: 40, y: 20 }, { x: 80, y: 60 }]);
    const after = objectsSnapshot(doc).find((o) => o.type === 'sticky')!;
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
    expect(strokesOf(doc)).toHaveLength(1);
  });

  it('the round cursor is the thickness at the current zoom', () => {
    renderApp();
    dispatchKey({ key: 'p' });
    expect(penTool().dataset.cursorSize).toBe(String(PEN_THICKNESS_WORLD.medium));
    fireEvent.click(toolButton('Thick'));
    setCamera({ x: 0, y: 0, zoom: 2 });
    expect(penTool().dataset.cursorSize).toBe(String(PEN_THICKNESS_WORLD.thick * 2));
    expect(penTool().style.cursor).toContain('data:image/svg+xml');
  });
});

describe('pen.tool switching', () => {
  it('TC-13 Escape, or V, switches to Select and creates nothing', () => {
    const { doc } = renderApp();
    const writes = countLocalWrites(doc);
    dispatchKey({ key: 'p' });
    expect(isPressed(penButton())).toBe(true);
    dispatchKey({ key: 'Escape' });
    expect(isPressed(toolButton('Select (V)'))).toBe(true);
    expect(screen.queryByTestId('pen-tool')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Pen options' })).toBeNull();

    fireEvent.click(penButton());
    expect(screen.getByRole('group', { name: 'Pen options' })).toBeTruthy();
    dispatchKey({ key: 'v' });
    expect(isPressed(toolButton('Select (V)'))).toBe(true);
    expect(screen.queryByTestId('pen-tool')).toBeNull();

    // Another tool from the toolbar too.
    dispatchKey({ key: 'p' });
    fireEvent.click(toolButton('Shape (S)'));
    expect(isPressed(penButton())).toBe(false);
    expect(writes.n).toBe(0);
    expect(strokesOf(doc)).toHaveLength(0);
  });

  it('TC-14 changing the colour keeps existing strokes; the next stroke uses it; choices are remembered', () => {
    const { doc } = renderApp();
    dispatchKey({ key: 'p' });
    drawWorld(underline);
    const [first] = strokesOf(doc);
    expect(first).toMatchObject({ color: 'black', thickness: 'medium' });
    fireEvent.click(toolButton('blue pen'));
    fireEvent.click(toolButton('Thin'));
    expect(strokesOf(doc)[0]).toMatchObject({ id: first.id, color: 'black', thickness: 'medium' });

    // Switching tools keeps the choice for the rest of the session.
    dispatchKey({ key: 'v' });
    dispatchKey({ key: 'p' });
    expect(isPressed(toolButton('blue pen'))).toBe(true);
    expect(isPressed(toolButton('Thin'))).toBe(true);
    drawWorld(underline.map((p) => ({ x: p.x, y: p.y + 100 })));
    const strokes = strokesOf(doc);
    expect(strokes).toHaveLength(2);
    expect(strokes.find((s) => s.id === first.id)).toMatchObject({ color: 'black', thickness: 'medium' });
    expect(strokes.find((s) => s.id !== first.id)).toMatchObject({ color: 'blue', thickness: 'thin' });
  });
});
