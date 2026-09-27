import { describe, expect, it } from 'vitest';
import {
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import {
  canZoomIn,
  canZoomOut,
  panBy,
  resetCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
  zoomPercent,
  zoomStep,
  type Camera,
  type Point,
  type Size,
} from '../../src/client/canvas/camera';

const VIEWPORT: Size = { width: 1200, height: 800 };
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;
/** Threshold from the design: pointer invariance is exact to within 1e-6. */
const EPS = 1e-6;

const cam = (x = 0, y = 0, zoom = 1): Camera => ({ x, y, zoom });
const pt = (x: number, y: number): Point => ({ x, y });

const expectClose = (actual: number, expected: number, eps = EPS): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(eps);
};

const expectPointClose = (actual: Point, expected: Point, eps = EPS): void => {
  expectClose(actual.x, expected.x, eps);
  expectClose(actual.y, expected.y, eps);
};

describe('screenToWorld / worldToScreen', () => {
  it('are inverse operations', () => {
    const c = cam(-1234.5, 678.25, ZOOM_STEP_FACTOR);
    const p = pt(4321, -876);
    expectPointClose(worldToScreen(c, screenToWorld(c, p)), p);
  });

  it('maps world origin to (-x * zoom, -y * zoom) on screen', () => {
    const c = cam(-100, 50, 2);
    expectPointClose(worldToScreen(c, pt(0, 0)), pt(200, -100));
  });
});

describe('panBy', () => {
  it('TC-01: at zoom 1 a drag of (+200,+100) screen px shifts the camera by (-200,-100) world units', () => {
    const before = cam(0, 0, 1);
    const after = panBy(before, 200, 100);
    expectClose(after.x, -200);
    expectClose(after.y, -100);
    expect(after.zoom).toBe(1);
    // the world point (0,0) now appears 200px right and 100px down
    expectPointClose(worldToScreen(after, pt(0, 0)), pt(200, 100));
  });

  it('TC-02: at ZOOM_MAX, far from the start, a drag shifts by delta/zoom world units exactly', () => {
    const before = cam(FAR, FAR, ZOOM_MAX);
    const after = panBy(before, 200, 100);
    expectClose(after.x, FAR - 200 / ZOOM_MAX);
    expectClose(after.y, FAR - 100 / ZOOM_MAX);
    expect(after).not.toBe(before);
  });

  it('returns the same object for a zero-length drag', () => {
    const before = cam(12, -34, 1.5);
    expect(panBy(before, 0, 0)).toBe(before);
  });

  it('does not mutate its input', () => {
    const before = cam(1, 2, 1);
    panBy(before, 10, 20);
    expect(before).toEqual({ x: 1, y: 2, zoom: 1 });
  });
});

describe('zoomAt', () => {
  it('TC-03: keeps the world point under the pointer at the same screen position (origin)', () => {
    const before = cam(0, 0, 1);
    const pointer = pt(300, 200);
    const after = zoomAt(before, pointer, 2);
    expectClose(after.zoom, 2);
    expectPointClose(screenToWorld(after, pointer), screenToWorld(before, pointer));
  });

  it('TC-04: keeps the pointer invariant far from the start (1e6 world units)', () => {
    const before = cam(FAR, -FAR, 1);
    const pointer = pt(300, 200);
    const after = zoomAt(before, pointer, 1.5);
    expectClose(after.zoom, 1.5);
    expectPointClose(screenToWorld(after, pointer), screenToWorld(before, pointer));
  });

  it('TC-05: at ZOOM_MIN zooming further out returns the same object and leaves x, y unchanged', () => {
    const before = cam(0, 0, ZOOM_MIN);
    const after = zoomAt(before, pt(VIEWPORT.width / 2, VIEWPORT.height / 2), 1 / ZOOM_STEP_FACTOR);
    expect(after).toBe(before);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.zoom).toBe(ZOOM_MIN);
  });

  it('TC-06: at ZOOM_MAX zooming further in returns the same object', () => {
    const before = cam(0, 0, ZOOM_MAX);
    const after = zoomAt(before, pt(VIEWPORT.width / 2, VIEWPORT.height / 2), ZOOM_STEP_FACTOR);
    expect(after).toBe(before);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.zoom).toBe(ZOOM_MAX);
  });

  it('TC-11: a huge factor clamps to ZOOM_MAX and still keeps the pointer invariant', () => {
    const before = cam(120, -80, 1);
    const pointer = pt(640, 400);
    const after = zoomAt(before, pointer, 1000);
    expect(after.zoom).toBe(ZOOM_MAX);
    expectPointClose(screenToWorld(after, pointer), screenToWorld(before, pointer));
  });

  it('TC-11b: a tiny factor clamps to ZOOM_MIN and still keeps the pointer invariant', () => {
    const before = cam(-400, 900, 1);
    const pointer = pt(100, 700);
    const after = zoomAt(before, pointer, 1 / 1000);
    expect(after.zoom).toBe(ZOOM_MIN);
    expectPointClose(screenToWorld(after, pointer), screenToWorld(before, pointer));
  });

  it('TC-12: invalid factors return the input camera unchanged and produce no NaN', () => {
    const before = cam(7, 9, 1.25);
    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const after = zoomAt(before, pt(10, 10), factor);
      expect(after).toBe(before);
      expect(Number.isFinite(after.x)).toBe(true);
      expect(Number.isFinite(after.y)).toBe(true);
      expect(Number.isFinite(after.zoom)).toBe(true);
    }
  });
});

describe('zoomStep', () => {
  it('TC-09: one step in then one step out returns exactly the starting zoom', () => {
    const before = cam(0, 0, 1);
    const inStep = zoomStep(before, VIEWPORT, 'in');
    expect(inStep.zoom).toBe(ZOOM_STEP_FACTOR);
    const outStep = zoomStep(inStep, VIEWPORT, 'out');
    expect(outStep.zoom).toBe(1);
    expect(zoomPercent(outStep)).toBe(100);
  });

  it('TC-09b: repeated steps do not drift (within the unclamped range)', () => {
    // Steps that hit ZOOM_MAX/ZOOM_MIN legitimately stop there, so this checks the
    // snap-to-step behaviour only between the limits: 1.25^5 and 1.25^-5 are inside.
    const stepsWithinLimits = Math.floor(
      Math.log(ZOOM_MAX) / Math.log(ZOOM_STEP_FACTOR),
    );
    let c: Camera = cam(-300, 200, 1);
    const start = c;
    for (let i = 0; i < stepsWithinLimits; i += 1) c = zoomStep(c, VIEWPORT, 'in');
    for (let i = 0; i < stepsWithinLimits; i += 1) c = zoomStep(c, VIEWPORT, 'out');
    expect(c.zoom).toBe(start.zoom);
    let d: Camera = cam(-300, 200, 1);
    for (let i = 0; i < stepsWithinLimits; i += 1) d = zoomStep(d, VIEWPORT, 'out');
    for (let i = 0; i < stepsWithinLimits; i += 1) d = zoomStep(d, VIEWPORT, 'in');
    expect(d.zoom).toBe(start.zoom);
  });

  it('TC-09c: steps keep the viewport centre fixed', () => {
    const centre = pt(VIEWPORT.width / 2, VIEWPORT.height / 2);
    const before = cam(-250, 125, 1);
    const after = zoomStep(before, VIEWPORT, 'in');
    expectPointClose(screenToWorld(after, centre), screenToWorld(before, centre));
  });

  it('TC-10: 20 steps in clamp at ZOOM_MAX and canZoomIn becomes false', () => {
    let c: Camera = cam(0, 0, 1);
    expect(canZoomIn(c)).toBe(true);
    for (let i = 0; i < 20; i += 1) c = zoomStep(c, VIEWPORT, 'in');
    expect(c.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(c)).toBe(false);
    expect(canZoomOut(c)).toBe(true);
  });

  it('TC-10b: 40 steps out clamp at ZOOM_MIN and canZoomOut becomes false', () => {
    let c: Camera = cam(0, 0, 1);
    for (let i = 0; i < 40; i += 1) c = zoomStep(c, VIEWPORT, 'out');
    expect(c.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(c)).toBe(false);
    expect(canZoomIn(c)).toBe(true);
  });

  it('TC-32a: a step that would cross a limit returns the same object', () => {
    const atMax = cam(11, 22, ZOOM_MAX);
    expect(zoomStep(atMax, VIEWPORT, 'in')).toBe(atMax);
    const atMin = cam(11, 22, ZOOM_MIN);
    expect(zoomStep(atMin, VIEWPORT, 'out')).toBe(atMin);
  });
});

describe('resetCamera', () => {
  it('TC-08: resets to zoom 1 with the world origin at the centre of the viewport', () => {
    const before = cam(FAR, -FAR, ZOOM_MAX);
    const after = resetCamera({ width: 1200, height: 800 });
    expect(after).not.toBe(before);
    expect(after.zoom).toBe(1);
    expect(after.x).toBeCloseTo(-600, 6);
    expect(after.y).toBeCloseTo(-400, 6);
    expectPointClose(worldToScreen(after, pt(0, 0)), pt(600, 400));
  });
});

describe('viewport resize', () => {
  it('TC-07: a viewport size change leaves the camera x, y and zoom unchanged', () => {
    // A resize is not an input to the camera: only resetCamera and zoomStep take a
    // viewport size, and neither is called on resize. The camera value is untouched.
    const before = Object.freeze(cam(-123.5, 456.25, 1.25));
    const afterResize: Camera = { ...before };
    expect(afterResize).toEqual({ x: -123.5, y: 456.25, zoom: 1.25 });
    expect(panBy(afterResize, 0, 0)).toBe(afterResize);
    expectPointClose(screenToWorld(afterResize, pt(0, 0)), pt(-123.5, 456.25));
  });
});

describe('zoomPercent', () => {
  it('rounds to the nearest whole percent', () => {
    expect(zoomPercent(cam(0, 0, 1))).toBe(100);
    expect(zoomPercent(cam(0, 0, ZOOM_MIN))).toBe(10);
    expect(zoomPercent(cam(0, 0, ZOOM_MAX))).toBe(400);
    expect(zoomPercent(cam(0, 0, 1.5625))).toBe(156);
    expect(zoomPercent(cam(0, 0, 1.5624))).toBe(156);
  });
});

describe('property: pointer invariance under zoomAt', () => {
  it('keeps the world point under the pointer fixed for 1,000 random cameras, points and factors', () => {
    // Seeded PRNG (mulberry32) so failures are reproducible.
    let state = 0x9e3779b9;
    const rand = (): number => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let i = 0; i < 1000; i += 1) {
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const position = (rand() - 0.5) * 2 * FAR;
      const before = cam(position, -position, zoom);
      const pointer = pt(rand() * 1280, rand() * 800);
      const factor = Math.exp((rand() - 0.5) * 2);
      const after = zoomAt(before, pointer, factor);
      expect(Number.isNaN(after.x)).toBe(false);
      expect(Number.isNaN(after.y)).toBe(false);
      expect(after.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expectPointClose(screenToWorld(after, pointer), screenToWorld(before, pointer));
    }
  });
});
