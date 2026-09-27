// Pen tool component tests (story 11, TC-09 to TC-14): capture (drag →
// stroke, click → dot), pointercancel commit, the 5,000-point split, tool
// revert (Escape) and per-stroke colour/thickness options. Full app at the
// 1280x800 fixture with the HOME camera, so world (0,0) is screen (640,400).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { act } from '@testing-library/react';
import {
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import { snapshot } from '../../src/shared/board-model';
import { scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import {
  dispatch,
  installResizeObserverMock,
  pointerEvent,
  renderApp,
  windowKey,
} from './helpers';
import { boardDoc, liveNotes } from './story7-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => cleanup());

function penBtn(): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>('button[aria-label="Pen (P)"]');
  if (el === null) throw new Error('Pen (P) button not rendered');
  return el;
}

function penOption(label: string): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>(`[data-testid="pen-toolbar"] button[aria-label="${label}"]`);
  if (el === null) throw new Error(`pen option "${label}" not rendered`);
  return el;
}

function penOverlay(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="pen-tool"]');
  if (el === null) throw new Error('pen tool overlay not rendered');
  return el;
}

function strokes(): StrokeSnap[] {
  return snapshot(boardDoc()).filter((o) => o.type === 'stroke') as StrokeSnap[];
}

/** Activate the pen tool (P) and return the overlay. */
function activatePen(container: HTMLElement): HTMLElement {
  windowKey('p');
  expect(penBtn().getAttribute('aria-pressed')).toBe('true');
  return penOverlay(container);
}

describe('pen.capture', () => {
  it('TC-09 drag with red + thick → one red/thick stroke; tool stays Pen', async () => {
    const { container } = await renderApp();
    const overlay = activatePen(container);
    // Pick red + thick from the pen toolbar.
    dispatch(penOption('Red pen'), new MouseEvent('click', { bubbles: true }));
    dispatch(penOption('Thick'), new MouseEvent('click', { bubbles: true }));

    dispatch(overlay, pointerEvent('pointerdown', 700, 450));
    dispatch(overlay, pointerEvent('pointermove', 800, 500));
    dispatch(overlay, pointerEvent('pointerup', 800, 500));

    const s = strokes();
    expect(s).toHaveLength(1);
    expect(s[0].color).toBe('red');
    expect(s[0].thickness).toBe('thick');
    // A real (non-dot) stroke: more than one point.
    expect(s[0].points.length).toBeGreaterThanOrEqual(4);
    // The tool remains Pen (it does not revert after a stroke).
    expect(penBtn().getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-10 a click (no movement) is a dot: two points, thickness×thickness bbox', async () => {
    const { container } = await renderApp();
    const overlay = activatePen(container);
    dispatch(overlay, pointerEvent('pointerdown', 700, 450));
    dispatch(overlay, pointerEvent('pointerup', 700, 450));

    const s = strokes();
    expect(s).toHaveLength(1);
    // One raw point flattened → two numbers.
    expect(s[0].points).toHaveLength(2);
    // Medium is the default (thickness 4): a 4×4 dot.
    expect(s[0].thickness).toBe('medium');
    expect(s[0].width).toBe(4);
    expect(s[0].height).toBe(4);
    // Centred on the click's world point (700,450) → world (60,50).
    expect(s[0].x).toBe(60 - 2);
    expect(s[0].y).toBe(50 - 2);
  });

  it('TC-11 pointercancel mid-drag commits the points so far (no data loss)', async () => {
    const { container } = await renderApp();
    const overlay = activatePen(container);
    dispatch(overlay, pointerEvent('pointerdown', 660, 410));
    dispatch(overlay, pointerEvent('pointermove', 700, 430));
    dispatch(overlay, pointerEvent('pointermove', 740, 460));
    dispatch(overlay, pointerEvent('pointercancel', 740, 460));

    const s = strokes();
    expect(s).toHaveLength(1);
    // The points so far (down + two moves) survive the cancel.
    expect(scaledPoints(s[0]).length).toBeGreaterThanOrEqual(2);
  });

  it('TC-12 a 5,010-point drag splits into two strokes joined at the seam', async () => {
    const { container } = await renderApp();
    const overlay = activatePen(container);
    act(() => {
      overlay.dispatchEvent(pointerEvent('pointerdown', 640, 400));
      for (let i = 1; i <= STROKE_MAX_POINTS + 10; i += 1) {
        overlay.dispatchEvent(pointerEvent('pointermove', 640 + i, 400));
      }
      overlay.dispatchEvent(pointerEvent('pointerup', 640 + STROKE_MAX_POINTS + 10, 400));
    });

    const s = strokes();
    expect(s).toHaveLength(2);
    const first = scaledPoints(s[0]);
    const second = scaledPoints(s[1]);
    // Part 2 starts where part 1 ends (the shared join point).
    expect(second[0]).toEqual(first[first.length - 1]);
  });

  it('TC-13 Escape returns to Select (no stroke) and the board is clean', async () => {
    const { container } = await renderApp();
    activatePen(container);
    windowKey('Escape');
    expect(penBtn().getAttribute('aria-pressed')).toBe('false');
    const sel = document.querySelector<HTMLButtonElement>('button[aria-label="Select (V)"]');
    expect(sel?.getAttribute('aria-pressed')).toBe('true');
    expect(liveNotes().filter((o) => o.type === 'stroke')).toHaveLength(0);
    // The overlay is gone (tool reverted to Select).
    expect(container.querySelector('[data-testid="pen-tool"]')).toBeNull();
  });

  it('TC-14 each stroke uses the options selected when it is drawn', async () => {
    const { container } = await renderApp();
    const overlay = activatePen(container);
    // First stroke: default black + medium.
    dispatch(overlay, pointerEvent('pointerdown', 660, 410));
    dispatch(overlay, pointerEvent('pointermove', 700, 430));
    dispatch(overlay, pointerEvent('pointerup', 700, 430));
    // Switch options, draw a second stroke.
    dispatch(penOption('Red pen'), new MouseEvent('click', { bubbles: true }));
    dispatch(overlay, pointerEvent('pointerdown', 760, 470));
    dispatch(overlay, pointerEvent('pointermove', 800, 490));
    dispatch(overlay, pointerEvent('pointerup', 800, 490));

    const s = strokes();
    expect(s).toHaveLength(2);
    expect(s[0].color).toBe('black');
    expect(s[0].thickness).toBe('medium');
    expect(s[1].color).toBe('red');
    expect(s[1].thickness).toBe('medium');
  });
});
