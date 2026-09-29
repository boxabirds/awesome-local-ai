// Story 11 (pen.select / pen.resize) component tests: TC-12 to TC-14.
//
// The y-websocket provider is replaced with a fake (as in the story 7/9/10
// tests) so every test deterministically reaches connected + synced
// (editable). jsdom has no layout: the viewport is 0×0, the camera resets
// to {0,0,1}, so world == screen coordinates in these tests.

import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
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

/** Flush rAF-batched gesture writes (fake timers). */
function flush(): Promise<void> {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(16);
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

/** The stroke's rendered SVG (inside its world-layer div). */
function strokeSvg(id: string): SVGSVGElement {
  const el = document.querySelector(`[data-testid="stroke-object"][data-id="${id}"] svg`);
  expect(el).not.toBeNull();
  return el as SVGSVGElement;
}

/** The stroke's clickable line (the second, transparent path). */
function strokeHitPath(id: string): SVGPathElement {
  const svg = strokeSvg(id);
  const paths = svg.querySelectorAll('path');
  expect(paths.length).toBe(2);
  return paths[1] as unknown as SVGPathElement;
}

/** Drags a straight line from (x1,y1) to (x2,y2) with the Pen tool. */
function drawLine(x1: number, y1: number, x2: number, y2: number): void {
  const vp = viewport();
  fire(vp, pointerEvent('pointerdown', x1, y1));
  fire(vp, pointerEvent('pointermove', (x1 + x2) / 2, (y1 + y2) / 2));
  fire(vp, pointerEvent('pointermove', x2, y2));
  fire(vp, pointerEvent('pointerup', x2, y2));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('story 11: stroke objects', () => {
  it('TC-12: a selected stroke shows the bbox + aspect-locked handles; a 2× corner drag scales the line proportionally; the thickness is unchanged', async () => {
    await setupApp();
    windowKey(key('keydown', { key: 'p' }));

    // Draw a stroke spanning (10,10)–(50,50): the 40×40 bounds padded by
    // the medium thickness (4) → a 44×44 bbox.
    drawLine(10, 10, 50, 50);
    const all = strokes();
    expect(all).toHaveLength(1);
    const s = all[0];
    expect(s.x).toBe(8);
    expect(s.y).toBe(8);
    expect(s.width).toBe(44);
    expect(s.height).toBe(44);
    expect(s.baseWidth).toBe(44);
    expect(s.baseHeight).toBe(44);

    // A finished stroke is selected → the bbox + all 8 handles are shown.
    expect(screen.getByTestId('selection-box')).toBeDefined();
    const se = screen.getByRole('button', { name: 'Resize bottom-right' });
    expect(se).toBeDefined();

    // The rendered line (d, thickness) BEFORE the resize.
    const before = strokeSvg(s.id);
    const pathBefore = (before.children[0] as SVGPathElement).getAttribute('d')!;
    const strokeBefore = (before.children[0] as SVGPathElement).getAttribute('stroke-width')!;
    expect(strokeBefore).toBe('4');

    // Drag the SE corner from (52,52) by (44,44): the box doubles (44 → 88).
    fire(se, pointerEvent('pointerdown', 52, 52));
    fire(window, pointerEvent('pointermove', 96, 96));
    await flush();
    fire(window, pointerEvent('pointerup', 96, 96));

    const afterSnap = strokes()[0];
    expect(afterSnap.width).toBe(88);
    expect(afterSnap.height).toBe(88);
    expect(afterSnap.thickness).toBe('medium'); // thickness is a field (pen.resize)

    // The rendered line: SAME d (stored points untouched) in a doubled box —
    // the viewBox→size mapping scales the line proportionally.
    const after = strokeSvg(s.id);
    const pathAfter = (after.children[0] as SVGPathElement).getAttribute('d')!;
    expect(pathAfter).toBe(pathBefore);
    expect((after.children[0] as SVGPathElement).getAttribute('stroke-width')).toBe(strokeBefore);
    expect(after.getAttribute('viewBox')).toBe('0 0 44 44'); // base size, unchanged
    expect(after.getAttribute('width')).toBe('88');
    expect(after.getAttribute('height')).toBe('88');
  });

  it('TC-13: a click on the line selects the stroke; a click on empty space does not (pen.select)', async () => {
    await setupApp();
    windowKey(key('keydown', { key: 'p' }));

    // Draw a horizontal line along y=0 from (0,0) to (100,0).
    drawLine(0, 0, 100, 0);
    const all = strokes();
    expect(all).toHaveLength(1);
    const id = all[0].id;

    // Escape back to the Select tool, clearing the selection.
    windowKey(key('keydown', { key: 'Escape' }));
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(window.__vidi6?.getSelectedIds()).toEqual([]);

    // A click ON the line (within the hit tolerance) selects the stroke.
    fire(strokeHitPath(id), pointerEvent('pointerdown', 50, 0));
    fire(strokeHitPath(id), pointerEvent('pointerup', 50, 0));
    expect(window.__vidi6?.getSelectedIds()).toEqual([id]);

    // A click on empty space (far from the line) selects nothing.
    fire(viewport(), pointerEvent('pointerdown', 50, 60));
    fire(viewport(), pointerEvent('pointerup', 50, 60));
    expect(window.__vidi6?.getSelectedIds()).toEqual([]);
  });

  it('TC-14: draw black, switch the pen to blue, draw → the second stroke is blue, the first stays black; Escape → Select', async () => {
    await setupApp();
    windowKey(key('keydown', { key: 'p' }));

    // The default colour is black.
    drawLine(0, 0, 40, 0);
    let all = strokes();
    expect(all).toHaveLength(1);
    expect(all[0].color).toBe('black');

    // Switch the pen to blue (the swatch is labelled "blue pen").
    act(() => {
      screen.getByRole('button', { name: 'blue pen' }).click();
    });
    expect(screen.getByRole('button', { name: 'blue pen' })).toHaveAttribute('aria-pressed', 'true');

    // The next stroke is blue…
    drawLine(10, 40, 50, 40);
    all = strokes();
    expect(all).toHaveLength(2);
    expect(all[1].color).toBe('blue');
    // …and the first one is untouched (pen.options: existing strokes keep
    // their own colour).
    expect(all[0].color).toBe('black');
    expect(document.querySelector(`[data-testid="stroke-object"][data-id="${all[0].id}"]`)).toHaveAttribute('data-color', 'black');
    expect(document.querySelector(`[data-testid="stroke-object"][data-id="${all[1].id}"]`)).toHaveAttribute('data-color', 'blue');

    // Escape leaves the Pen tool (→ Select).
    windowKey(key('keydown', { key: 'Escape' }));
    expect(penBtn()).toHaveAttribute('aria-pressed', 'false');
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('pen-tool')).toBeNull();
  });
});
