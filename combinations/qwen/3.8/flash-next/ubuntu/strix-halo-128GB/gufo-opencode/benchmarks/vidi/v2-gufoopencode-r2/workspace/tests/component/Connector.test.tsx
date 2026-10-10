// Story 10 TC-18…TC-21: the Connector tool shows side dots on hover, creates
// an attached arrow on drag with the target side highlighted, selection uses
// the 6 px screen tolerance at two zoom levels, and end handles re-attach to
// another object or release to a free point.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WebsocketProvider } from 'y-websocket';
import type { ConnectorSnap } from '../../src/shared/board-model';
import {
  App,
  flush,
  keyDown,
  pressAndRelease,
  readCamera,
} from './stickyHelpers';
import { connectorEl, makeConnector, makeShape, screenOf } from './shapeHelpers';

vi.mock('y-websocket', () => {
  class MockWebsocketProvider {
    static instances: MockWebsocketProvider[] = [];
    private handlers = new Map<string, Set<(arg?: unknown) => void>>();
    awareness = { setLocalState: (_state: unknown) => undefined };

    constructor(_server: string, _room: string, _doc: unknown, _opts?: unknown) {
      MockWebsocketProvider.instances.push(this);
    }
    on(event: string, cb: (arg?: unknown) => void): void {
      if (!this.handlers.has(event)) this.handlers.set(event, new Set());
      this.handlers.get(event)!.add(cb);
    }
    off(event: string, cb: (arg?: unknown) => void): void {
      this.handlers.get(event)?.delete(cb);
    }
    emit(event: string, arg?: unknown): void {
      this.handlers.get(event)?.forEach((cb) => cb(arg));
    }
    destroy(): void {
      /* no-op */
    }
  }
  return { WebsocketProvider: MockWebsocketProvider };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

function allConnectors(): ConnectorSnap[] {
  const hooks = window.__vidi6?.board;
  if (!hooks) throw new Error('board test hooks not installed');
  return (hooks.getObjectSnapshots!() as ConnectorSnap[]).filter((o) => o.type === 'connector');
}

function hitLine(id: string): Element {
  return connectorEl(id).querySelector('[data-testid="connector-hit"]')!;
}

describe('connector.ui (component)', () => {
  it('TC-18: hovering an object with the Connector tool shows four side dots', () => {
    render(<App />);
    flush();
    const id = makeShape('rect', 100, 100, 160, 100);
    keyDown(window, 'l');
    flush();

    const cam = readCamera();
    const centre = screenOf(180, 150, cam);
    const catcher = screen.getByTestId('connector-tool-catcher');
    fireEvent.pointerMove(catcher, { pointerId: 1, clientX: centre.x, clientY: centre.y });
    flush();

    const dots = screen.getAllByTestId('connector-dot');
    expect(dots).toHaveLength(4);
    expect(dots.map((d) => d.getAttribute('data-side')).sort()).toEqual([
      'bottom',
      'left',
      'right',
      'top',
    ]);
    void id;
  });

  it("TC-19: dragging from A to B highlights B's nearest dot and creates an attached arrow", () => {
    render(<App />);
    flush();
    const a = makeShape('rect', 100, 100, 160, 100); // centre (180, 150)
    const b = makeShape('diamond', 500, 100, 160, 100); // centre (580, 150)

    keyDown(window, 'l');
    flush();
    const cam = readCamera();
    const from = screenOf(180, 150, cam);
    const to = screenOf(580, 150, cam);
    const catcher = screen.getByTestId('connector-tool-catcher');
    fireEvent.pointerDown(catcher, { pointerId: 1, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: to.x, clientY: to.y });
    flush();
    expect(screen.getByTestId('connector-dot-highlight')).toBeTruthy();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: to.x, clientY: to.y });
    flush();

    const created = allConnectors();
    expect(created).toHaveLength(1);
    const ends = created[0];
    if (ends.from.kind !== 'attached' || ends.to.kind !== 'attached') {
      throw new Error('expected both ends attached');
    }
    expect([ends.from.objectId, ends.to.objectId].sort()).toEqual([a, b].sort());
    expect(screen.getByTestId('tool-select').getAttribute('aria-pressed')).toBe('true');
    expect(connectorEl(created[0].id).getAttribute('data-selected')).toBe('true');
  });

  it('TC-20: a click within 6 px (screen) of the line selects; farther clicks do not, at 100% and 200%', () => {
    render(<App />);
    flush();
    // Free horizontal arrow (200,400) → (400,400).
    const id = makeConnector({ kind: 'free', x: 200, y: 400 }, { kind: 'free', x: 400, y: 400 });

    const tryClick = (offsetPx: number): boolean => {
      const cam = readCamera();
      const p = screenOf(300, 400, cam);
      pressAndRelease(hitLine(id) as HTMLElement, p.x, p.y + offsetPx);
      flush();
      const selected = connectorEl(id).getAttribute('data-selected') === 'true';
      if (selected) {
        keyDown(window, 'Escape'); // deselect before the next attempt
        flush();
      }
      return selected;
    };

    expect(tryClick(5)).toBe(true);
    expect(tryClick(7)).toBe(false);

    // Below 100% (three zoom-out steps): the tolerance follows screen
    // pixels, so the same offsets decide at any zoom.
    fireEvent.click(screen.getByLabelText('Zoom out'));
    fireEvent.click(screen.getByLabelText('Zoom out'));
    fireEvent.click(screen.getByLabelText('Zoom out'));
    flush();
    expect(readCamera().zoom).toBeLessThan(1);
    expect(tryClick(5)).toBe(true);
    expect(tryClick(7)).toBe(false);

    // Back above 100% (four zoom-in steps) and check again.
    fireEvent.click(screen.getByLabelText('Zoom in'));
    fireEvent.click(screen.getByLabelText('Zoom in'));
    fireEvent.click(screen.getByLabelText('Zoom in'));
    fireEvent.click(screen.getByLabelText('Zoom in'));
    flush();
    expect(readCamera().zoom).toBeGreaterThan(1);
    expect(tryClick(5)).toBe(true);
    expect(tryClick(7)).toBe(false);
  });

  it("TC-21: dragging the selected arrow's end handle attaches to another object, and releasing on empty space frees it", () => {
    render(<App />);
    flush();
    const a = makeShape('rect', 100, 100, 160, 100); // centre (180, 150)
    const c = makeShape('ellipse', 600, 100, 160, 100); // centre (680, 150)
    const d = makeShape('rect', 300, 500, 160, 100); // centre (380, 550)

    const id = makeConnector(
      { kind: 'attached', objectId: a, fallback: { x: 260, y: 150 } },
      { kind: 'attached', objectId: c, fallback: { x: 600, y: 150 } },
    );

    const cam = readCamera();
    const onLine = screenOf(430, 150, cam);
    pressAndRelease(hitLine(id) as HTMLElement, onLine.x, onLine.y);
    flush();
    expect(connectorEl(id).getAttribute('data-selected')).toBe('true');
    const handle = connectorEl(id).querySelector('[data-testid="connector-handle-to"]')!;

    // Onto D: the end follows D.
    const dCentre = screenOf(380, 550, cam);
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: onLine.x, clientY: onLine.y });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: dCentre.x, clientY: dCentre.y });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: dCentre.x, clientY: dCentre.y });
    flush();
    expect(allConnectors()[0].to).toMatchObject({ kind: 'attached', objectId: d });

    // Onto empty space: the end becomes free at the release point.
    const handle2 = connectorEl(id).querySelector('[data-testid="connector-handle-to"]')!;
    const empty = screenOf(300, 800, cam);
    fireEvent.pointerDown(handle2, { pointerId: 3, clientX: dCentre.x, clientY: dCentre.y });
    fireEvent.pointerMove(window, { pointerId: 3, clientX: empty.x, clientY: empty.y });
    fireEvent.pointerUp(window, { pointerId: 3, clientX: empty.x, clientY: empty.y });
    flush();
    const end = allConnectors()[0].to;
    expect(end.kind).toBe('free');
    if (end.kind === 'free') {
      expect(end.x).toBeCloseTo(300, 1);
      expect(end.y).toBeCloseTo(800, 1);
    }
  });
});
