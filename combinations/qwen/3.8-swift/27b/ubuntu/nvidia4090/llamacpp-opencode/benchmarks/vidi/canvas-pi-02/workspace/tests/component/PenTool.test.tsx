// Story 11 (pen.*) component tests: TC-09 to TC-11.
//
// The y-websocket provider is replaced with a fake (as in the story 7/9/10
// tests) so every test deterministically reaches connected + synced
// (editable). jsdom has no layout: the viewport is 0×0, the camera resets
// to {0,0,1}, so world == screen coordinates in these tests.

import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { handwrittenLoopPath } from '../fixtures/pen-paths';
import { renderAppAt } from './render-app';

/** Fake provider: records the doc it was given and lets tests emit the
 *  provider events the tracker listens for. */
interface FakeProvider {
  doc: Y.Doc;
  open(): void;
  doSync(): void;
  close(code: number): void;
}

vi.mock('y-websocket', () => {
  class FakeWebsocketProvider {
    static instances: FakeProvider[] = [];
    doc: Y.Doc;
    private listeners: Record<string, Array<(arg: unknown) => void>> = {};
    constructor(_url: string, _room: string, doc: Y.Doc, _opts: unknown) {
      this.doc = doc;
      FakeWebsocketProvider.instances.push(this);
    }
    on(ev: string, fn: (arg: unknown) => void): void {
      (this.listeners[ev] ??= []).push(fn);
    }
    off(ev: string, fn: (arg: unknown) => void): void {
      this.listeners[ev] = (this.listeners[ev] ?? []).filter((f) => f !== fn);
    }
    destroy(): void {
      this.listeners = {};
    }
    private emit(ev: string, arg: unknown): void {
      (this.listeners[ev] ?? []).slice().forEach((f) => f(arg));
    }
    open(): void {
      this.emit('status', { status: 'connected' });
    }
    doSync(): void {
      this.emit('sync', true);
    }
    close(code: number): void {
      this.emit('connection-close', { code, reason: 'test' });
      this.emit('status', { status: 'disconnected' });
    }
  }
  return { WebsocketProvider: FakeWebsocketProvider };
});

const fakeProviders = (): FakeProvider[] =>
  (WebsocketProvider as unknown as { instances: FakeProvider[] }).instances;

/** jsdom has no PointerEvent; dispatch a plain event carrying pointer fields. */
function pointerEvent(type: string, x: number, y: number, extra: Record<string, unknown> = {}): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { clientX: x, clientY: y, pointerId: 1, isPrimary: true, ...extra });
  return e;
}

function fire(target: EventTarget, e: Event): void {
  act(() => {
    target.dispatchEvent(e);
  });
}

function key(type: string, props: Record<string, unknown> = {}): Event {
  return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...props });
}

function windowKey(e: Event): boolean {
  act(() => {
    window.dispatchEvent(e);
  });
  return e.defaultPrevented;
}

async function setupApp(): Promise<Y.Doc> {
  await renderAppAt();
  const all = fakeProviders();
  expect(all.length).toBeGreaterThan(0);
  const provider = all[all.length - 1];
  act(() => provider.open());
  act(() => provider.doSync());
  return provider.doc;
}

const selectBtn = () => screen.getByRole('button', { name: 'Select (V)' });
const penBtn = () => screen.getByRole('button', { name: 'Pen (P)' });
const viewport = () => screen.getByTestId('board-viewport');

interface StrokeView {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  baseWidth: number;
  baseHeight: number;
  color: string;
  thickness: string;
  points: number[];
  z: number;
}

const strokes = (): StrokeView[] => window.__vidi6?.getStrokes() ?? [];
const pointCount = (s: StrokeView): number => s.points.length / 2;

/** The stroke's world-space points (base size). */
const worldPoints = (s: StrokeView): { x: number; y: number }[] => {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < s.points.length; i += 2) {
    out.push({ x: s.x + s.points[i], y: s.y + s.points[i + 1] });
  }
  return out;
};

/** A deterministic wiggle of `n` points from (0,0) (the long-stroke tests). */
function longPath(n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: i * 0.05, y: Math.sin(i / 9) * 3 });
  }
  return out;
}

/** Drags `pts` on the viewport (pointerdown at pts[0], moves, pointerup). */
function dragPoints(pts: { x: number; y: number }[]): void {
  const vp = viewport();
  fire(vp, pointerEvent('pointerdown', pts[0].x, pts[0].y));
  for (let i = 1; i < pts.length; i++) {
    fire(vp, pointerEvent('pointermove', pts[i].x, pts[i].y));
  }
  fire(vp, pointerEvent('pointerup', pts[pts.length - 1].x, pts[pts.length - 1].y));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('story 11: the Pen tool', () => {
  it('TC-09: P → Pen active; a 400-point drag → 1 stroke (points ≤ 400) on top; selected; tool STAYS Pen', async () => {
    await setupApp();

    // P activates the Pen tool (the toolbar button is pressed).
    windowKey(key('keydown', { key: 'p' }));
    expect(penBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('pen-tool')).toBeDefined();
    expect(screen.getByTestId('pen-toolbar')).toBeDefined();

    // Drag the recorded handwritten loop (400 points).
    dragPoints([...handwrittenLoopPath]);
    vi.advanceTimersByTime(50); // flush the rAF preview repaints

    const all = strokes();
    expect(all).toHaveLength(1);
    const s = all[0];
    expect(pointCount(s)).toBeLessThanOrEqual(400);
    expect(pointCount(s)).toBeGreaterThan(1); // a real line, not a dot
    expect(s.color).toBe('black'); // the default colour
    expect(s.thickness).toBe('medium'); // the default thickness

    // The finished stroke is selected…
    expect(window.__vidi6?.getSelectedIds()).toEqual([s.id]);
    // …and the tool stays the Pen (pen.stay_active): Select is not active.
    expect(penBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'false');
    // The stroke renders in the world layer.
    const el = document.querySelector(`[data-testid="stroke-object"][data-id="${s.id}"]`);
    expect(el).not.toBeNull();
  });

  it('TC-10: 5,000-point drag → 1 stroke; 5,001 → 2 strokes sharing the boundary point; a plain click → a dot (bbox = thickness)', async () => {
    await setupApp();
    windowKey(key('keydown', { key: 'p' }));

    // Exactly STROKE_MAX_POINTS raw points → ONE stroke.
    dragPoints(longPath(5000));
    expect(strokes()).toHaveLength(1);
    expect(pointCount(strokes()[0])).toBeLessThanOrEqual(5000);

    // STROKE_MAX_POINTS + 1 → the drag splits into TWO strokes; the second
    // starts with the first's last world point (seamless join,
    // pen.long_stroke). (Plus the 1 stroke from the previous drag.)
    dragPoints(longPath(5001));
    const after = strokes();
    expect(after).toHaveLength(3);
    const [partA, partB] = after.slice(-2);
    const last = worldPoints(partA)[worldPoints(partA).length - 1];
    const first = worldPoints(partB)[0];
    // The shared boundary point (equal up to float round-trip of the
    // bbox-offset storage).
    expect(first.x).toBeCloseTo(last.x, 10);
    expect(first.y).toBeCloseTo(last.y, 10);

    // A click without movement draws a round dot: a 1-point stroke whose
    // bbox is exactly the current thickness (pen.dot).
    const vp = viewport();
    fire(vp, pointerEvent('pointerdown', 200, 100));
    fire(vp, pointerEvent('pointerup', 200, 100));
    const dot = strokes().at(-1)!;
    expect(dot.id).not.toBe(partB.id);
    expect(pointCount(dot)).toBe(1);
    expect(dot.width).toBe(4); // medium thickness (4 world units)
    expect(dot.height).toBe(4);
    // The dot is centred on the click.
    expect(dot.x).toBe(200 - 2);
    expect(dot.y).toBe(100 - 2);
  });

  it('TC-11: a pointercancel mid-drag → the partial stroke is kept; the tool stays Pen', async () => {
    await setupApp();
    windowKey(key('keydown', { key: 'p' }));

    const pts = handwrittenLoopPath.slice(0, 120); // 120 of the 400 points
    const vp = viewport();
    fire(vp, pointerEvent('pointerdown', pts[0].x, pts[0].y));
    for (let i = 1; i < pts.length; i++) {
      fire(vp, pointerEvent('pointermove', pts[i].x, pts[i].y));
    }
    fire(vp, pointerEvent('pointercancel', pts[pts.length - 1].x, pts[pts.length - 1].y));
    vi.advanceTimersByTime(50);

    const all = strokes();
    expect(all).toHaveLength(1);
    // The partial stroke kept the points drawn so far (≤ 120 after
    // simplification; more than a dot).
    expect(pointCount(all[0])).toBeLessThanOrEqual(120);
    expect(pointCount(all[0])).toBeGreaterThan(1);
    // The tool stays active after an interrupted stroke.
    expect(penBtn()).toHaveAttribute('aria-pressed', 'true');
  });
});
