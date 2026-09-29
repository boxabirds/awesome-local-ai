// Story 11, task 3: component tests for the Pen tool (TC-09..TC-14): the
// preview while dragging, stroke creation (draw / dot / interrupted / long),
// Escape + V switching, and colour persistence.
//
// The App is rendered against a mocked connector; jsdom has no CSS layout, so
// geometry is asserted through the model (world (0,0) is screen (512,384) at
// the deterministic camera).

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { newBoardId } from '../../src/shared/board-id';
import { objectSnapshot } from '../../src/shared/board-model';
import { scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import {
  DEFAULT_PEN_THICKNESS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { flushFrame, makeEvent } from './helpers';
import { resetBoardForTests, setBoardCamera as setCam } from '../../src/client/canvas/useCamera';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import type { Camera } from '../../src/client/canvas/camera';

const SEED = vi.hoisted(() => ({
  state: 'connected' as ConnectionState,
  doc: null as Y.Doc | null,
  seed: (_doc: Y.Doc): void => undefined,
}));

vi.mock('../../src/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api')>();
  return { ...actual, checkBoard: vi.fn().mockResolvedValue({ kind: 'exists' }) };
});

vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  return {
    ...actual,
    connectBoard: (doc: Y.Doc, _boardId: string, onState: (s: ConnectionState) => void) => {
      onState(SEED.state);
      SEED.doc = doc;
      queueMicrotask(() => {
        if (objectSnapshot(doc).length !== 0) return;
        SEED.seed(doc);
      });
      return { destroy: (): void => undefined };
    },
  };
});

// World (0,0) at screen (512,384), zoom 1.
const CAM: Camera = { x: -512, y: -384, zoom: 1 };

function dis(target: EventTarget, type: string, props: Record<string, unknown>): void {
  act(() => {
    target.dispatchEvent(makeEvent(type, props));
  });
}
function pressKey(key: string, init: Record<string, unknown> = {}): void {
  dis(window, 'keydown', { key, ...init });
}
function penPressed(): boolean {
  return screen.getByRole('button', { name: 'Pen (P)' }).getAttribute('aria-pressed') === 'true';
}
function selectPressed(): boolean {
  return screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed') === 'true';
}
async function openBoard(): Promise<void> {
  window.history.pushState({}, '', `/b/${newBoardId()}`);
  render(<App />);
  await act(async () => undefined);
  act(() => {
    setCam(CAM);
  });
}
function strokes(): StrokeSnap[] {
  return objectSnapshot(SEED.doc!).filter((o) => o.type === 'stroke') as StrokeSnap[];
}
/** The stroke's points in world units (bbox-relative + the bbox origin). */
function worldPointsOf(s: StrokeSnap): Point[] {
  return scaledPoints(s).map((p) => ({ x: p.x + s.x, y: p.y + s.y }));
}
/** A press + moves + release through window pointer events. */
function draw(from: Point, moves: Point[], to: Point): void {
  const vp = screen.getByTestId('board-viewport');
  dis(vp, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: from.x, clientY: from.y });
  for (const m of moves) dis(window, 'pointermove', { pointerId: 1, clientX: m.x, clientY: m.y });
  dis(window, 'pointerup', { pointerId: 1, clientX: to.x, clientY: to.y });
}

describe('story 11: pen tool (TC-09..TC-14)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBoardForTests();
    SEED.state = 'connected';
    SEED.doc = null;
    SEED.seed = () => undefined;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.pushState({}, '', '/');
  });

  it('TC-09: a drag with red + thick selected shows the preview, creates one red/thick stroke, and stays pen', async () => {
    await openBoard();
    pressKey('p');
    expect(penPressed()).toBe(true);
    // Choose red + thick in the pen toolbar.
    fireEvent.click(screen.getByRole('button', { name: 'Red pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thick' }));

    const vp = screen.getByTestId('board-viewport');
    dis(vp, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 600, clientY: 400 });
    dis(window, 'pointermove', { pointerId: 1, clientX: 650, clientY: 450 });
    dis(window, 'pointermove', { pointerId: 1, clientX: 700, clientY: 500 });
    dis(window, 'pointermove', { pointerId: 1, clientX: 750, clientY: 550 });
    flushFrame(); // render the rAF-coalesced preview

    // The preview path is present with multiple segments during the drag.
    const preview = screen.getByTestId('pen-preview-path');
    const d = preview.getAttribute('d') ?? '';
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain(' Q ');

    dis(window, 'pointerup', { pointerId: 1, clientX: 750, clientY: 550 });
    const list = strokes();
    expect(list).toHaveLength(1);
    expect(list[0].color).toBe('red');
    expect(list[0].thickness).toBe('thick');
    // The pen stays active after committing (pen.stay_active).
    expect(penPressed()).toBe(true);
  });

  it('TC-10: a click (no travel) creates a single-point dot', async () => {
    await openBoard();
    pressKey('p');
    const vp = screen.getByTestId('board-viewport');
    dis(vp, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 600, clientY: 400 });
    dis(window, 'pointerup', { pointerId: 1, clientX: 600, clientY: 400 });
    const list = strokes();
    expect(list).toHaveLength(1);
    // A dot: one point (two numbers) and a thickness-square bbox.
    const t = PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS];
    expect(list[0].points).toHaveLength(2);
    expect(list[0].width).toBeCloseTo(t);
    expect(list[0].height).toBeCloseTo(t);
  });

  it('TC-11: a pointercancel commits the points drawn so far', async () => {
    await openBoard();
    pressKey('p');
    const vp = screen.getByTestId('board-viewport');
    dis(vp, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 600, clientY: 400 });
    dis(window, 'pointermove', { pointerId: 1, clientX: 700, clientY: 500 });
    dis(window, 'pointercancel', { pointerId: 1, clientX: 700, clientY: 500 });
    const list = strokes();
    expect(list).toHaveLength(1);
    // The two drawn points (down + one move) are kept.
    expect(list[0].points).toHaveLength(4);
  });

  it('TC-12: a drag of STROKE_MAX_POINTS + 10 points splits into two strokes that join at the boundary', async () => {
    await openBoard();
    pressKey('p');
    const vp = screen.getByTestId('board-viewport');
    dis(vp, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 600, clientY: 400 });
    const n = STROKE_MAX_POINTS + 10;
    act(() => {
      for (let i = 1; i <= n; i++) {
        window.dispatchEvent(
          makeEvent('pointermove', { pointerId: 1, clientX: 600 + (i % 300), clientY: 400 + Math.floor(i / 300) }),
        );
      }
    });
    dis(window, 'pointerup', { pointerId: 1, clientX: 900, clientY: 420 });
    const list = strokes();
    expect(list).toHaveLength(2);
    // The second stroke starts where the first ended (a seamless join).
    const first = worldPointsOf(list[0]);
    const second = worldPointsOf(list[1]);
    const join = first[first.length - 1];
    expect(second[0].x).toBeCloseTo(join.x, 0);
    expect(second[0].y).toBeCloseTo(join.y, 0);
  });

  it('TC-13: Escape (then V) returns to Select with no stroke created', async () => {
    await openBoard();
    pressKey('p');
    expect(penPressed()).toBe(true);
    pressKey('Escape');
    pressKey('v');
    expect(selectPressed()).toBe(true);
    expect(penPressed()).toBe(false);
    expect(strokes()).toHaveLength(0);
  });

  it('TC-14: changing the colour after a stroke keeps the old colour and applies the new one to the next', async () => {
    await openBoard();
    pressKey('p');
    // First stroke with the default (black) colour.
    draw({ x: 600, y: 400 }, [{ x: 700, y: 480 }], { x: 700, y: 480 });
    expect(strokes()).toHaveLength(1);
    const firstColour = strokes()[0].color;
    // Switch to red, then draw a second stroke.
    fireEvent.click(screen.getByRole('button', { name: 'Red pen' }));
    draw({ x: 760, y: 460 }, [{ x: 860, y: 540 }], { x: 860, y: 540 });
    const list = strokes();
    expect(list).toHaveLength(2);
    // The first stroke is unchanged; the second uses red.
    expect(list[0].color).toBe(firstColour);
    expect(list[1].color).toBe('red');
  });
});
