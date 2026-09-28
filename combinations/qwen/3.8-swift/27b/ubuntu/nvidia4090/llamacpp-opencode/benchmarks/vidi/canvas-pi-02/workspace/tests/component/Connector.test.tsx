// Story 10 (conn.*) component tests: TC-18 to TC-21.
//
// The y-websocket provider is replaced with a fake (as in the story 7/9/10
// shape tests) so every test deterministically reaches connected + synced
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
const connectorBtn = () => screen.getByRole('button', { name: 'Connector (L)' });
const connectorTool = () => screen.getByTestId('connector-tool');

/** Drag on the Connector tool overlay from (x1,y1) to (x2,y2). */
function dragConnector(x1: number, y1: number, x2: number, y2: number): void {
  const tool = connectorTool();
  fire(tool, pointerEvent('pointerdown', x1, y1));
  fire(tool, pointerEvent('pointermove', x2, y2));
  fire(tool, pointerEvent('pointerup', x2, y2));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('story 10: the Connector tool', () => {
  it('TC-18: L → Connector active; hovering shape A shows 4 dots at its side midpoints', async () => {
    await setupApp();
    // A: a 160×160 rect at (0,0) → midpoints (80,0),(160,80),(80,160),(0,80).
    const a = window.__vidi6?.createShape(0, 0, 'rect');
    expect(a).not.toBeNull();

    windowKey(key('keydown', { key: 'l' }));
    expect(connectorBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(connectorTool()).toBeDefined();

    // Hover over A (its centre).
    fire(connectorTool(), pointerEvent('pointermove', 80, 80));

    const dots = screen.getAllByTestId('connector-dot');
    expect(dots).toHaveLength(4);
    const pts = new Set(
      dots.map((d) => `${Number(d.getAttribute('cx'))},${Number(d.getAttribute('cy'))}`).sort(),
    );
    expect(pts).toEqual(new Set(['80,0', '160,80', '80,160', '0,80']));
    // No dot is highlighted while merely hovering.
    expect(dots.every((d) => d.getAttribute('data-highlighted') === null)).toBe(true);
  });

  it('TC-19: L, drag A → B, release → arrow attached to A and B; tool → Select; arrow follows B', async () => {
    await setupApp();
    // A: rect (0,0)–(160,160); B: rect (300,0)–(460,160).
    const a = window.__vidi6?.createShape(0, 0, 'rect');
    const b = window.__vidi6?.createShape(300, 0, 'rect');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    windowKey(key('keydown', { key: 'l' }));
    // Drag from A's centre to B's centre.
    dragConnector(80, 80, 380, 80);

    const conns = window.__vidi6?.getConnectors() ?? [];
    expect(conns).toHaveLength(1);
    expect(conns[0].from).toEqual({ kind: 'attached', objectId: a });
    expect(conns[0].to).toEqual({ kind: 'attached', objectId: b });
    // Resolved: A's right anchor (160,80) → B's left anchor (300,80).
    expect(conns[0].fromPoint).toEqual({ x: 160, y: 80 });
    expect(conns[0].toPoint).toEqual({ x: 300, y: 80 });

    // The created connector is selected and the tool is one-shot (→ Select).
    expect(window.__vidi6?.getSelectedIds()).toEqual([conns[0].id]);
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(connectorBtn()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('connector-tool')).toBeNull();

    // The arrow FOLLOWS B when B moves (conn.follow): move B, the resolved
    // line's end tracks B's new left anchor.
    expect(window.__vidi6?.moveSticky(b as string, 300, 100)).toBe(true);
    const moved = window.__vidi6?.getConnectors() ?? [];
    expect(moved[0].toPoint).toEqual({ x: 300, y: 180 });
  });

  it("TC-20: dragging A → B highlights B's NEAREST side dot while over B", async () => {
    await setupApp();
    const a = window.__vidi6?.createShape(0, 0, 'rect');
    const b = window.__vidi6?.createShape(300, 0, 'diamond');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    windowKey(key('keydown', { key: 'l' }));
    // Press on A, then move over B (B's centre is (380,80)).
    fire(connectorTool(), pointerEvent('pointerdown', 80, 80));
    fire(connectorTool(), pointerEvent('pointermove', 380, 80));

    // B's dots are shown, and B's LEFT side (nearest to A) is highlighted.
    const dots = screen.getAllByTestId('connector-dot');
    const left = dots.find((d) => d.getAttribute('data-side') === 'left');
    expect(left).toBeDefined();
    expect(left).toHaveAttribute('data-highlighted', 'true');
    // The other sides of B are not highlighted.
    for (const side of ['top', 'right', 'bottom']) {
      const d = dots.find((dd) => dd.getAttribute('data-side') === side);
      expect(d?.getAttribute('data-highlighted')).toBeNull();
    }

    // Release on B: attached.
    fire(connectorTool(), pointerEvent('pointerup', 380, 80));
    const conns = window.__vidi6?.getConnectors() ?? [];
    expect(conns).toHaveLength(1);
    expect(conns[0].from).toEqual({ kind: 'attached', objectId: a });
    expect(conns[0].to).toEqual({ kind: 'attached', objectId: b });
  });

  it('TC-21: dragging A → empty board → free endpoint at the drop point', async () => {
    await setupApp();
    const a = window.__vidi6?.createShape(0, 0, 'rect');
    expect(a).not.toBeNull();

    windowKey(key('keydown', { key: 'l' }));
    // Press on A's centre, release far away on empty board.
    dragConnector(80, 80, 300, 400);

    const conns = window.__vidi6?.getConnectors() ?? [];
    expect(conns).toHaveLength(1);
    expect(conns[0].from).toEqual({ kind: 'attached', objectId: a });
    expect(conns[0].to).toEqual({ kind: 'free', x: 300, y: 400 });
    // The line runs from A's right anchor (nearest to the drop point,
    // which is right-and-below) to the free point.
    expect(conns[0].toPoint).toEqual({ x: 300, y: 400 });
  });
});
