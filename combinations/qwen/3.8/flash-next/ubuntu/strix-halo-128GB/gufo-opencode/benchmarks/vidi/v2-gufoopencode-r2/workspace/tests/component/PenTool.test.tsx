// Story 11 TC-09 to TC-14: the Pen tool commits strokes on release (with the
// selected colour/thickness), draws a dot on a click, keeps points from an
// interrupted drag, splits at STROKE_MAX_POINTS with a shared join, cancels
// silently on Escape, and never restyles existing strokes when options
// change. The tool stays active after every commit.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WebsocketProvider } from 'y-websocket';
import { PEN_THICKNESS_WORLD } from '../../src/shared/config';
import { scaledPoints } from '../../src/shared/objects/stroke';
import { longSpiral } from '../fixtures/pen-paths';
import {
  App,
  flush,
  keyDown,
  readCamera,
} from './stickyHelpers';
import { penDownMove, penDraw, penUp, strokes } from './penHelpers';

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

function pressPen(): void {
  keyDown(window, 'p');
  flush();
}

describe('pen.tool (component)', () => {
  it('TC-09: drag with red + thick commits one stroke in that style and the pen stays active', () => {
    render(<App />);
    flush();
    pressPen();
    expect(screen.getByTestId('pen-toolbar')).toBeInTheDocument();
    expect(screen.getByLabelText('Black pen')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Medium')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByLabelText('Red pen'));
    fireEvent.click(screen.getByLabelText('Thick'));

    penDraw([
      { x: 120, y: 100 },
      { x: 140, y: 110 },
      { x: 160, y: 130 },
      { x: 190, y: 150 },
      { x: 220, y: 180 },
    ]);

    const all = strokes();
    expect(all).toHaveLength(1);
    expect(all[0].color).toBe('red');
    expect(all[0].thickness).toBe('thick');
    expect(screen.getByTestId('tool-pen')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('pen-toolbar')).toBeInTheDocument();
  });

  it('TC-10: press and release without movement commits a single-point dot', () => {
    render(<App />);
    flush();
    pressPen();
    penDraw([{ x: 150, y: 150 }]);
    const all = strokes();
    expect(all).toHaveLength(1);
    expect(all[0].points).toHaveLength(2);
    expect(all[0].width).toBe(PEN_THICKNESS_WORLD.medium);
    expect(all[0].height).toBe(PEN_THICKNESS_WORLD.medium);
  });

  it('TC-11: pointercancel after some moves commits the points drawn so far', () => {
    render(<App />);
    flush();
    pressPen();
    penDownMove([
      { x: 100, y: 100 },
      { x: 130, y: 120 },
      { x: 160, y: 150 },
      { x: 180, y: 190 },
    ]);
    expect(strokes()).toHaveLength(0); // nothing synced to the doc while drawing
    const catcher = screen.getByTestId('pen-tool-catcher');
    fireEvent.pointerCancel(catcher, { pointerId: 1, clientX: 180, clientY: 190 });
    flush();
    const all = strokes();
    expect(all).toHaveLength(1);
    expect(all[0].points.length).toBeGreaterThanOrEqual(2);
  });

  it('TC-12: a drag reaching the point limit commits two strokes that share the join point', () => {
    render(<App />);
    flush();
    pressPen();
    const raw = longSpiral(5011); // pointerdown + 5010 moves
    penDownMove(raw);
    penUp(raw[raw.length - 1]);

    const all = strokes();
    expect(all).toHaveLength(2);
    const p1 = scaledPoints(all[0]);
    const p2 = scaledPoints(all[1]);
    const join1 = p1[p1.length - 1];
    expect(p2[0].x).toBeCloseTo(join1.x, 3);
    expect(p2[0].y).toBeCloseTo(join1.y, 3);
  });

  it('TC-13: Escape leaves the pen without creating a stroke; V stays on select', () => {
    render(<App />);
    flush();
    pressPen();
    keyDown(window, 'Escape');
    flush();
    expect(screen.queryByTestId('pen-tool-catcher')).not.toBeInTheDocument();
    expect(screen.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
    keyDown(window, 'v');
    flush();
    expect(strokes()).toHaveLength(0);
  });

  it('TC-14: changing the colour after a stroke exists only affects the next stroke', () => {
    render(<App />);
    flush();
    pressPen();
    penDraw([
      { x: 100, y: 100 },
      { x: 120, y: 110 },
      { x: 150, y: 130 },
    ]);
    const first = strokes()[0];
    fireEvent.click(screen.getByLabelText('Blue pen'));
    penDraw([
      { x: 300, y: 100 },
      { x: 320, y: 110 },
      { x: 350, y: 130 },
    ]);
    const all = strokes();
    expect(all).toHaveLength(2);
    expect(all.find((s) => s.id === first.id)!.color).toBe('black');
    expect(all.find((s) => s.id !== first.id)!.color).toBe('blue');
  });
});
