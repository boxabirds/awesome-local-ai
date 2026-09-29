/**
 * Component tests for the Pen *tool* (story 11, design TC-09 to TC-14).
 *
 * The real `App` over a real `Y.Doc`, with pointer events dispatched the way the
 * running app receives them: `pointerdown` on the board surface and moves on the
 * window, where the gesture listeners live. Nothing is stubbed — when a test says
 * "one stroke was drawn", it means the document says so.
 *
 * What a stroke does *after* it exists (being picked by its line, moved, kept out
 * of the way of the object underneath it) belongs to `StrokeObject.test.tsx`.
 */
import { describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { strokePathData, toPoints } from '../../src/shared/objects/stroke';
import { flush, renderApp } from './appHarness';
import { dispatch } from './harness';
import {
  circle,
  draw,
  drawFast,
  key,
  penOn,
  pointer,
  spiral,
  strokeElements,
  strokes,
} from './penScene';

describe('the Pen tool (pen.toolbar, TC-09)', () => {
  it('has a toolbar button that turns the pen on', async () => {
    const harness = renderApp();
    const button = harness.container.querySelector<HTMLButtonElement>(
      '[data-testid="tool-pen"]',
    );
    expect(button).not.toBeNull();
    expect(button!.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      button!.click();
    });
    await flush();

    expect(button!.getAttribute('aria-pressed')).toBe('true');
    // The options that come with the pen are on screen the moment the pen is.
    expect(harness.container.querySelector('[data-testid="pen-options"]')).not.toBeNull();
  });

  it('comes on with the letter P, and Escape takes it off', async () => {
    const harness = renderApp();
    await penOn(harness);
    const button = harness.container.querySelector<HTMLButtonElement>(
      '[data-testid="tool-pen"]',
    );
    expect(button!.getAttribute('aria-pressed')).toBe('true');

    await dispatch(window, key('Escape'));
    await flush();
    expect(button!.getAttribute('aria-pressed')).toBe('false');
  });

  it('does not follow the one-stroke-per-tool convention', async () => {
    const harness = renderApp();
    await penOn(harness);
    // First stroke: the pen is still the pen afterwards.
    await draw(harness, [
      { x: 100, y: 100 },
      { x: 140, y: 140 },
      { x: 180, y: 100 },
    ]);
    expect(strokes(harness)).toHaveLength(1);
    const button = harness.container.querySelector<HTMLButtonElement>(
      '[data-testid="tool-pen"]',
    );
    expect(button!.getAttribute('aria-pressed')).toBe('true');
  });

  it('draws a second stroke without a second activation', async () => {
    const harness = renderApp();
    await penOn(harness);
    await draw(harness, [
      { x: 100, y: 100 },
      { x: 200, y: 120 },
    ]);
    await draw(harness, [
      { x: 300, y: 200 },
      { x: 360, y: 260 },
    ]);
    expect(strokes(harness)).toHaveLength(2);
    expect(strokeElements(harness)).toHaveLength(2);
  });
});

describe('drawing (pen.draw, TC-10 to TC-12)', () => {
  it('TC-10 turns one gesture into one stroke whose ink is the gesture', async () => {
    const harness = renderApp();
    await penOn(harness);
    await draw(harness, [
      { x: 100, y: 100 },
      { x: 120, y: 130 },
      { x: 150, y: 140 },
      { x: 190, y: 120 },
      { x: 220, y: 160 },
    ]);
    const drawn = strokes(harness);
    expect(drawn).toHaveLength(1);
    const stroke = drawn[0]!;
    // The box is the box of what was drawn: the ink reaches both far edges and no
    // further, because the resize gesture measures this box.
    const points = toPoints((stroke as unknown as { points: number[] }).points);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    expect(Math.min(...xs)).toBeCloseTo(0, 1);
    expect(Math.max(...xs)).toBeCloseTo(120, 1);
    expect(Math.min(...ys)).toBeCloseTo(0, 1);
    expect(Math.max(...ys)).toBeCloseTo(60, 1);
  });

  it('paints the stroke while the pen is down and stops the moment it is up', async () => {
    const harness = renderApp();
    await penOn(harness);
    const surface = harness.board();
    await dispatch(surface, pointer('pointerdown', 120, 120, 1));
    await dispatch(window, pointer('pointermove', 200, 180, 1));
    await flush();
    // One preview, not one preview per point.
    expect(
      harness.container.querySelectorAll('[data-testid="stroke-preview"]').length,
    ).toBe(1);
    // And the preview is not in the document: an unfinished stroke is nobody
    // else's business, so it lives in local state only (D2).
    expect(strokes(harness)).toHaveLength(0);
    await dispatch(window, pointer('pointerup', 200, 180, 0));
    await flush();
    expect(
      harness.container.querySelectorAll('[data-testid="stroke-preview"]').length,
    ).toBe(0);
    expect(strokes(harness)).toHaveLength(1);
    expect(strokeElements(harness)).toHaveLength(1);
  });

  it('grows the preview as the pen travels, and keeps it to one path', async () => {
    const harness = renderApp();
    await penOn(harness);
    const surface = harness.board();
    await dispatch(surface, pointer('pointerdown', 100, 100, 1));
    await dispatch(window, pointer('pointermove', 160, 140, 1));
    await flush();
    const before = harness.container.querySelector('[data-testid="stroke-preview"]');
    const early = before?.querySelector('path')?.getAttribute('d') ?? '';
    await dispatch(window, pointer('pointermove', 220, 120, 1));
    await dispatch(window, pointer('pointermove', 260, 200, 1));
    await flush();
    const preview = harness.container.querySelector('[data-testid="stroke-preview"]');
    const later = preview?.querySelector('path')?.getAttribute('d') ?? '';
    expect(preview).toBe(before);
    expect(later.length).toBeGreaterThan(early.length);
    expect(preview?.querySelectorAll('path')).toHaveLength(1);
  });

  it('keeps drawing over a note, and the note stays where it was', async () => {
    const harness = renderApp([{ x: 200, y: 200 }]);
    const before = harness.notes()[0]!;
    await penOn(harness);
    await draw(harness, [
      { x: 180, y: 180 },
      { x: 250, y: 250 },
      { x: 330, y: 230 },
    ]);
    const after = harness.notes()[0]!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(strokes(harness)).toHaveLength(1);
    // The stroke was added after the note, so it is the thing on top of it.
    const elements = strokeElements(harness);
    expect(elements).toHaveLength(1);
    expect(elements[0]!.getAttribute('data-stroke-kind')).toBe('polyline');
  });

  it('cancels the stroke when Escape is pressed mid-draw', async () => {
    const harness = renderApp();
    await penOn(harness);
    await draw(harness, [
      { x: 100, y: 100 },
      { x: 160, y: 160 },
      { x: 220, y: 120 },
      { x: 280, y: 200 },
    ], { escapeMidway: true });
    expect(strokes(harness)).toHaveLength(0);
    expect(harness.container.querySelector('[data-testid="stroke-preview"]')).toBeNull();
  });

  it('cancels the stroke when the tool changes mid-draw', async () => {
    const harness = renderApp();
    await penOn(harness);
    await draw(harness, [
      { x: 100, y: 100 },
      { x: 160, y: 160 },
      { x: 220, y: 120 },
      { x: 280, y: 200 },
    ], { switchMidway: 'v' });
    expect(strokes(harness)).toHaveLength(0);
  });

  it('takes the colour and the width the options were set to', async () => {
    const harness = renderApp();
    await penOn(harness);
    const blue = harness.container.querySelector<HTMLButtonElement>(
      '[data-testid="pen-color-blue"]',
    );
    const thick = harness.container.querySelector<HTMLButtonElement>(
      '[data-testid="pen-thickness-thick"]',
    );
    expect(blue).not.toBeNull();
    expect(thick).not.toBeNull();
    await act(async () => {
      blue!.click();
    });
    await act(async () => {
      thick!.click();
    });
    await draw(harness, [
      { x: 100, y: 100 },
      { x: 200, y: 140 },
    ]);
    const stroke = strokes(harness)[0] as unknown as { color: string; thickness: string };
    expect(stroke).toBeDefined();
    expect(stroke.color).toBe('blue');
    expect(stroke.thickness).toBe('thick');
  });

  it('does not restyle the stroke that is already on the board', async () => {
    const harness = renderApp();
    await penOn(harness);
    await draw(harness, [
      { x: 100, y: 100 },
      { x: 200, y: 140 },
    ]);
    const before = strokes(harness)[0] as unknown as {
      id: string;
      color: string;
      thickness: string;
    };
    expect(before.color).toBe('black');
    await act(async () => {
      harness.container
        .querySelector<HTMLButtonElement>('[data-testid="pen-color-blue"]')!
        .click();
    });
    await draw(harness, [
      { x: 300, y: 100 },
      { x: 400, y: 140 },
    ]);
    const after = strokes(harness);
    expect(after).toHaveLength(2);
    // The first drawing keeps the pen it was drawn with. They are looked up by id
    // rather than by position, because the document does not promise that a new
    // object lands at the end of the list.
    const first = after.find((entry) => entry.id === before.id) as unknown as {
      color: string;
    };
    const second = after.find((entry) => entry.id !== before.id) as unknown as {
      color: string;
    };
    expect(first.color).toBe('black');
    expect(second.color).toBe('blue');
  });

  it('does not break the stroke when the options change mid-draw', async () => {
    const harness = renderApp();
    await penOn(harness);
    const surface = harness.board();
    await dispatch(surface, pointer('pointerdown', 100, 100, 1));
    await dispatch(window, pointer('pointermove', 160, 140, 1));
    await flush();
    const thick = harness.container.querySelector<HTMLButtonElement>(
      '[data-testid="pen-thickness-thick"]',
    );
    await act(async () => {
      thick!.click();
    });
    await dispatch(window, pointer('pointermove', 220, 120, 1));
    await dispatch(window, pointer('pointerup', 220, 120, 0));
    await flush();
    // One line, drawn one way, not a thin half and a thick half.
    expect(strokes(harness)).toHaveLength(1);
  });
});

describe('a closed stroke (pen.circle, TC-13)', () => {
  it('TC-13 brings a circle back as one closed stroke, not a shape', async () => {
    const harness = renderApp();
    await penOn(harness);
    await drawFast(harness, circle(400, 300, 90));
    const drawn = strokes(harness);
    expect(drawn).toHaveLength(1);
    const stroke = drawn[0] as unknown as { closed: boolean; type: string };
    expect(stroke.type).toBe('stroke');
    expect(stroke.closed).toBe(true);
    // One stroke, and the last point joined the first without a straight seam
    // drawn across the middle of it.
    const element = strokeElements(harness)[0]!;
    expect(element.getAttribute('data-stroke-closed')).toBe('true');
    const path = strokePathData(drawn[0] as never);
    expect(path.endsWith('Z')).toBe(true);
    expect(path.indexOf('Z')).toBe(path.lastIndexOf('Z'));
  });

  it('leaves an open arc open, whatever its bounding box looks like', async () => {
    const harness = renderApp();
    await penOn(harness);
    // Most of a circle, but the two ends are far apart: the box is square and
    // the shape is not.
    await drawFast(harness, circle(400, 300, 90, 0.75, 60));
    const stroke = strokes(harness)[0] as unknown as { closed: boolean };
    expect(stroke.closed).toBe(false);
    expect(strokeElements(harness)[0]!.getAttribute('data-stroke-closed')).toBe('false');
  });

  it('treats a spiral that ends in the middle as a spiral', async () => {
    const harness = renderApp();
    await penOn(harness);
    await drawFast(harness, spiral(400, 300, 100));
    const drawn = strokes(harness);
    expect(drawn.length).toBeGreaterThanOrEqual(1);
    for (const stroke of drawn) {
      expect((stroke as unknown as { closed: boolean }).closed).toBe(false);
    }
    for (const element of strokeElements(harness)) {
      expect(element.getAttribute('data-stroke-closed')).toBe('false');
    }
  });
});

describe('a long stroke (pen.long_stroke, TC-14)', () => {
  it('TC-14 splits a path longer than the budget into joined strokes', async () => {
    const harness = renderApp();
    await penOn(harness);
    // A serpentine sweep of 5,400 samples across the board.
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < 5400; i += 1) {
      points.push({
        x: 60 + (i % 40) * 12,
        y: 80 + Math.floor(i / 40) * 3 + Math.sin(i / 5) * 2,
      });
    }
    await drawFast(harness, points);
    const drawn = strokes(harness);
    expect(drawn.length).toBeGreaterThanOrEqual(2);
    // Nothing is lost: the parts together still draw the line that was drawn, and
    // each part starts where the one before it stopped.
    const path = drawn.map((stroke) => strokePathData(stroke as never)).join(' ');
    expect(path.length).toBeGreaterThan(100);
    expect(strokeElements(harness).length).toBe(drawn.length);
    for (let index = 1; index < drawn.length; index += 1) {
      // Each part keeps its points relative to its own box, so the join has to be
      // measured where the ink actually is on the board.
      const previous = drawn[index - 1] as unknown as {
        x: number;
        y: number;
        points: number[];
      };
      const current = drawn[index] as unknown as { x: number; y: number; points: number[] };
      const before = toPoints(previous.points);
      const after = toPoints(current.points);
      const join = before[before.length - 1]!;
      const start = after[0]!;
      expect(
        Math.hypot(
          previous.x + join.x - (current.x + start.x),
          previous.y + join.y - (current.y + start.y),
        ),
      ).toBeLessThan(1);
    }
  });
});