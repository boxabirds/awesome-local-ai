// Story 10 TC-22: the Shape and Connector tools return to Select after a
// create, and Escape switches back to Select creating nothing — including
// during an unfinished drag.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WebsocketProvider } from 'y-websocket';
import { App, flush, keyDown, readCamera } from './stickyHelpers';
import { connectors, makeShape, screenOf, shapes } from './shapeHelpers';

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

function pressed(testId: string): boolean {
  return screen.getByTestId(testId).getAttribute('aria-pressed') === 'true';
}

describe('tools.active_tool', () => {
  it('TC-22: creating with the Shape tool and with the Connector tool returns to Select; Escape creates nothing', () => {
    render(<App />);
    flush();
    const cam = readCamera();

    // S → click-create → Select.
    keyDown(window, 's');
    flush();
    expect(pressed('tool-shape')).toBe(true);
    const catcher = screen.getByTestId('shape-tool-catcher');
    fireEvent.pointerDown(catcher, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 200, clientY: 200 });
    flush();
    expect(shapes()).toHaveLength(1);
    expect(pressed('tool-select')).toBe(true);
    expect(screen.queryByTestId('shape-tool-catcher')).toBeNull();

    // L → drag-create between two shapes → Select.
    const b = makeShape('rect', 700, 200, 160, 100);
    keyDown(window, 'l');
    flush();
    expect(pressed('tool-connector')).toBe(true);
    const cCatcher = screen.getByTestId('connector-tool-catcher');
    const aCentre = screenOf(cam.x + 200, cam.y + 200, cam); // the click-created default shape centre
    const bCentre = screenOf(780, 250, cam);
    fireEvent.pointerDown(cCatcher, { pointerId: 1, clientX: aCentre.x, clientY: aCentre.y });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: bCentre.x, clientY: bCentre.y });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: bCentre.x, clientY: bCentre.y });
    flush();
    expect(connectors()).toHaveLength(1);
    expect(pressed('tool-select')).toBe(true);
    void b;

    // S then Escape: back to Select, still the same two shapes.
    keyDown(window, 's');
    flush();
    keyDown(window, 'Escape');
    flush();
    expect(pressed('tool-select')).toBe(true);
    expect(shapes()).toHaveLength(2);

    // L then Escape during an unfinished drag: nothing is created.
    keyDown(window, 'l');
    flush();
    const c2 = screen.getByTestId('connector-tool-catcher');
    fireEvent.pointerDown(c2, { pointerId: 1, clientX: aCentre.x, clientY: aCentre.y });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: bCentre.x, clientY: bCentre.y });
    keyDown(window, 'Escape');
    flush();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: bCentre.x, clientY: bCentre.y });
    flush();
    expect(connectors()).toHaveLength(1);
    expect(pressed('tool-select')).toBe(true);
  });
});
