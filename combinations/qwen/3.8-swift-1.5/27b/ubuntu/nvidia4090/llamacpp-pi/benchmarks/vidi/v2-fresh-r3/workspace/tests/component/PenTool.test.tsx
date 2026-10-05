import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, act } from '@testing-library/react';
import { renderApp, pointerEvent, windowKeyDown } from './appHarness';
import { snapshotObjects } from '../../src/shared/board-model';
import { scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';
import type * as Y from 'yjs';

afterEach(cleanup);

/** Every stroke snap in the doc, in (z, id) order. */
function strokes(doc: Y.Doc): StrokeSnap[] {
  return snapshotObjects(doc).filter((o) => o.type === 'stroke') as StrokeSnap[];
}

/** Arms the Pen tool (P shortcut) and returns its overlay. */
function activatePen(): HTMLElement {
  act(() => windowKeyDown('p'));
  expect(screen.getByLabelText('Pen (P)').getAttribute('aria-pressed')).toBe('true');
  return screen.getByTestId('pen-tool-overlay');
}

describe('pen.tool (ui-component)', () => {
  it('TC-09: pointerdown/moves/up with red + thick selected → createStroke once with red/thick; tool still pen', async () => {
    const app = await renderApp();
    const overlay = activatePen();

    // Pick red and thick on the pen toolbar (visible while the Pen is active).
    act(() => screen.getByLabelText('red pen').click());
    act(() => screen.getByLabelText('Thick').click());

    act(() => pointerEvent(overlay, 'pointerdown', 100, 100));
    act(() => pointerEvent(overlay, 'pointermove', 200, 150));
    act(() => pointerEvent(overlay, 'pointermove', 300, 200));
    act(() => pointerEvent(overlay, 'pointerup', 300, 200));

    const s = strokes(app.doc);
    expect(s).toHaveLength(1);
    expect(s[0].color).toBe('red');
    expect(s[0].thickness).toBe('thick');
    expect(scaledPoints(s[0]).length).toBeGreaterThanOrEqual(2);

    // The Pen stays active after a finished stroke (pen.stay_active).
    expect(screen.getByLabelText('Pen (P)').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Select (V)').getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-10: pointerdown/up without movement → single-point dot committed', async () => {
    const app = await renderApp();
    const overlay = activatePen();

    act(() => pointerEvent(overlay, 'pointerdown', 200, 200));
    act(() => pointerEvent(overlay, 'pointerup', 200, 200));

    const s = strokes(app.doc);
    expect(s).toHaveLength(1);
    // A dot: one stored point (flattened length 2) in a thickness square.
    expect(s[0].points).toHaveLength(2);
    const t = PEN_THICKNESS_WORLD[s[0].thickness];
    expect(s[0].width).toBe(t);
    expect(s[0].height).toBe(t);
    expect(scaledPoints(s[0])).toEqual([{ x: 200, y: 200 }]);
  });

  it('TC-11: pointerdown, moves, pointercancel → stroke committed with points so far', async () => {
    const app = await renderApp();
    const overlay = activatePen();

    act(() => pointerEvent(overlay, 'pointerdown', 100, 100));
    act(() => pointerEvent(overlay, 'pointermove', 200, 150));
    act(() => pointerEvent(overlay, 'pointermove', 300, 200));
    act(() => pointerEvent(overlay, 'pointercancel', 300, 200));

    const s = strokes(app.doc);
    expect(s).toHaveLength(1);
    // The stroke so far is kept: it starts where the drag started.
    const pts = scaledPoints(s[0]);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    expect(pts[0].x).toBeCloseTo(100, 3);
    expect(pts[0].y).toBeCloseTo(100, 3);
    // The preview is cleared.
    expect(screen.queryByTestId('pen-preview')).toBeNull();
  });

  it('TC-12: STROKE_MAX_POINTS + 10 moves → two commits; second starts at first\'s last point', async () => {
    const app = await renderApp();
    const overlay = activatePen();

    act(() => pointerEvent(overlay, 'pointerdown', 100, 100));
    for (let i = 1; i <= STROKE_MAX_POINTS + 10; i++) {
      pointerEvent(overlay, 'pointermove', 100 + i, 100);
    }
    act(() => pointerEvent(overlay, 'pointerup', 100 + STROKE_MAX_POINTS + 10, 100));

    const s = strokes(app.doc);
    expect(s).toHaveLength(2);
    const first = scaledPoints(s[0]);
    const second = scaledPoints(s[1]);
    // The second part starts at the first part's last point (no visible gap).
    expect(second[0].x).toBeCloseTo(first[first.length - 1].x, 6);
    expect(second[0].y).toBeCloseTo(first[first.length - 1].y, 6);
    // The first part holds the point limit (simplified below it).
    expect(first.length).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    expect(second.length).toBeGreaterThan(1);
  });

  it('TC-13: Escape; press V → tool becomes select; no stroke created', async () => {
    const app = await renderApp();
    activatePen();

    act(() => windowKeyDown('Escape'));
    expect(screen.getByLabelText('Select (V)').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Pen (P)').getAttribute('aria-pressed')).toBe('false');
    expect(strokes(app.doc)).toHaveLength(0);
    // The overlay is gone.
    expect(screen.queryByTestId('pen-tool-overlay')).toBeNull();

    act(() => windowKeyDown('v'));
    expect(screen.getByLabelText('Select (V)').getAttribute('aria-pressed')).toBe('true');
    expect(strokes(app.doc)).toHaveLength(0);
  });

  it('TC-14: change colour after a stroke exists → existing stroke unchanged; next stroke uses new colour', async () => {
    const app = await renderApp();
    const overlay = activatePen();

    // First stroke in the default colour (black).
    act(() => pointerEvent(overlay, 'pointerdown', 100, 100));
    act(() => pointerEvent(overlay, 'pointermove', 200, 100));
    act(() => pointerEvent(overlay, 'pointerup', 200, 100));

    // Switch to red; the existing stroke must keep its colour.
    act(() => screen.getByLabelText('red pen').click());
    expect(strokes(app.doc)[0].color).toBe('black');

    act(() => pointerEvent(overlay, 'pointerdown', 100, 300));
    act(() => pointerEvent(overlay, 'pointermove', 200, 300));
    act(() => pointerEvent(overlay, 'pointerup', 200, 300));

    const s = strokes(app.doc);
    expect(s).toHaveLength(2);
    expect(s[0].color).toBe('black');
    expect(s[1].color).toBe('red');
  });
});
