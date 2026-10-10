// Story 11 TC-15, TC-16, TC-21: stroke selection uses line distance scaled
// to zoom (not the bounding box), clicks inside the box but far from the
// line fall through to objects below, and deleting a selected stroke leaves
// no stale selection behind.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WebsocketProvider } from 'y-websocket';
import { getObjectType } from '../../src/client/objects/registry';
import { deleteObject } from '../../src/shared/board-model';
import {
  App,
  board,
  createNote,
  flush,
  noteEl,
  readCamera,
} from './stickyHelpers';
import { screenOf } from './shapeHelpers';
import { makeStroke, strokeEl, strokes } from './penHelpers';

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

function strokeHit(id: string): Element {
  return strokeEl(id).querySelector('[data-testid="stroke-hit"]')!;
}

describe('stroke.ui (component)', () => {
  it('TC-15: hit test uses screen-space line distance, not the bbox, at any zoom', () => {
    render(<App />);
    flush();
    const id = makeStroke([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 300, y: 100 },
    ]);
    const s = strokes()[0];
    const spec = getObjectType('stroke')!;

    // zoom 0.5: tolerance 6/0.5 = 12 world units (5 screen px = 10, 7 px = 14)
    expect(spec.hitTest(s, { x: 200, y: 110 }, 0.5)).toBe(true);
    expect(spec.hitTest(s, { x: 200, y: 114 }, 0.5)).toBe(false);
    // zoom 2: tolerance 6/2 = 3 world units (5 screen px = 2.5, 7 px = 3.5)
    expect(spec.hitTest(s, { x: 200, y: 102.5 }, 2)).toBe(true);
    expect(spec.hitTest(s, { x: 200, y: 103.5 }, 2)).toBe(false);
    // Inside the bbox but farther than 6 screen px from the line is a miss.
    expect(spec.hitTest(s, { x: 200, y: 93 }, 1)).toBe(false);
    expect(id).toBeTruthy();
  });

  it('TC-16: a far-inside-bbox click skips the stroke and selects the sticky below', () => {
    render(<App />);
    flush();
    const noteId = createNote(100, 100);
    const strokeId = makeStroke([
      { x: 110, y: 110 },
      { x: 200, y: 200 },
      { x: 290, y: 290 },
    ]);
    const cam = readCamera();
    // Inside the stroke bbox (x/y ~109..291) but ~120 world units from the
    // diagonal: a miss for the stroke, a hit for the sticky underneath.
    const far = { x: 115, y: 285 };
    const spec = getObjectType('stroke')!;
    expect(spec.hitTest(strokes()[0], far, cam.zoom)).toBe(false);
    expect(spec.hitTest(strokes()[0], { x: 200, y: 200 }, cam.zoom)).toBe(true);

    const p = screenOf(far.x, far.y, cam);
    fireEvent.pointerDown(strokeEl(strokeId), { pointerId: 1, clientX: p.x, clientY: p.y });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: p.x, clientY: p.y });
    flush();
    expect(strokeEl(strokeId)).toHaveAttribute('data-selected', 'false');
    expect(noteEl(noteId)).toHaveAttribute('data-selected', 'false');

    // The same press landing on the sticky element selects the sticky.
    fireEvent.pointerDown(noteEl(noteId), { pointerId: 1, clientX: p.x, clientY: p.y });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: p.x, clientY: p.y });
    flush();
    expect(noteEl(noteId)).toHaveAttribute('data-selected', 'true');
    expect(strokeEl(strokeId)).toHaveAttribute('data-selected', 'false');
  });

  it('TC-21: a selected stroke renders handles and deletes cleanly', () => {
    render(<App />);
    flush();
    const id = makeStroke([
      { x: 110, y: 110 },
      { x: 200, y: 200 },
      { x: 290, y: 290 },
    ]);
    const cam = readCamera();
    const onLine = screenOf(200, 200, cam);
    const hit = strokeHit(id);
    fireEvent.pointerDown(hit, { pointerId: 1, clientX: onLine.x, clientY: onLine.y });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: onLine.x, clientY: onLine.y });
    flush();
    expect(strokeEl(id)).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('selection-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('handle-se')).toBeInTheDocument();

    act(() => {
      deleteObject(board().doc, id);
    });
    flush();
    expect(screen.queryAllByTestId('stroke-object')).toHaveLength(0);
    expect(screen.queryByTestId('selection-overlay')).not.toBeInTheDocument();
  });
});
