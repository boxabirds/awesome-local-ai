// Story 10 TC-15, TC-16, TC-17, TC-28: the Shape tool creates by dragging
// (with a screen-space preview), labels clamp to 500 characters, the shape
// toolbar recolours without touching anything else, and a drag that starts
// over an existing object sizes the shape instead of moving that object.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WebsocketProvider } from 'y-websocket';
import type { ShapeSnap } from '../../src/shared/board-model';
import {
  App,
  createNote,
  flush,
  keyDown,
  notes,
  pressAndRelease,
  readCamera,
} from './stickyHelpers';
import { dragOn, makeShape, screenOf, shapeEl, shapes } from './shapeHelpers';

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

function shape(id: string): ShapeSnap {
  return shapes().find((s) => s.id === id) as ShapeSnap;
}

describe('shape.ui (component)', () => {
  it('TC-15: S then a drag previews and creates a shape covering the dragged area, selected, back to Select', () => {
    render(<App />);
    flush();
    const cam = readCamera();

    keyDown(window, 's');
    flush();
    expect(screen.getByTestId('tool-shape').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('shape-kind-menu')).toBeTruthy();

    const catcher = screen.getByTestId('shape-tool-catcher');
    fireEvent.pointerDown(catcher, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 220 });
    expect(screen.getByTestId('shape-preview')).toBeTruthy();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 220 });
    flush();

    const created = shapes();
    expect(created).toHaveLength(1);
    const s = created[0] as ShapeSnap;
    expect(s.kind).toBe('rect');
    expect(s.x).toBeCloseTo(cam.x + 100 / cam.zoom, 6);
    expect(s.y).toBeCloseTo(cam.y + 100 / cam.zoom, 6);
    expect(s.width).toBeCloseTo(200 / cam.zoom, 6);
    expect(s.height).toBeCloseTo(120 / cam.zoom, 6);
    expect(screen.queryByTestId('shape-preview')).toBeNull();
    expect(shapeEl(s.id).getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('tool-select').getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-16: double-click opens the label editor and typing beyond 500 characters is clamped', () => {
    render(<App />);
    flush();
    const id = makeShape('rect', 0, 0, 200, 100);

    fireEvent.doubleClick(shapeEl(id));
    flush();
    const textarea = screen.getByTestId('shape-label') as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'x'.repeat(600) } });
    flush();

    expect(textarea.value).toHaveLength(500);
    expect(shape(id).label).toHaveLength(500);
  });

  it('TC-17: fill and outline swatches restyle without changing label, position or selection', () => {
    render(<App />);
    flush();
    const id = makeShape('rect', 100, 100, 200, 120);

    pressAndRelease(shapeEl(id));
    flush();
    expect(screen.getByTestId('shape-toolbar')).toBeTruthy();

    fireEvent.click(screen.getByTestId('shape-fill-blue'));
    fireEvent.click(screen.getByTestId('shape-stroke-red'));
    flush();

    const s = shape(id);
    expect(s.fill).toBe('blue');
    expect(s.stroke).toBe('red');
    expect(s.x).toBeCloseTo(100, 6);
    expect(s.y).toBeCloseTo(100, 6);
    expect(s.width).toBeCloseTo(200, 6);
    expect(s.height).toBeCloseTo(120, 6);
    expect(s.label).toBe('');
    expect(shapeEl(id).getAttribute('data-selected')).toBe('true');
  });

  it('TC-28: a Shape-tool drag starting over an existing note sizes the shape and never moves the note', () => {
    render(<App />);
    flush();
    const noteId = createNote(100, 100);
    const before = notes().find((n) => n.id === noteId)!;
    const beforeX = before.x;
    const beforeY = before.y;

    keyDown(window, 's');
    flush();
    const cam = readCamera();
    const over = screenOf(150, 150, cam);
    dragOn(over, { x: over.x + 120, y: over.y + 90 });

    expect(shapes()).toHaveLength(1);
    const after = notes().find((n) => n.id === noteId)!;
    expect(after.x).toBe(beforeX);
    expect(after.y).toBe(beforeY);
  });
});
