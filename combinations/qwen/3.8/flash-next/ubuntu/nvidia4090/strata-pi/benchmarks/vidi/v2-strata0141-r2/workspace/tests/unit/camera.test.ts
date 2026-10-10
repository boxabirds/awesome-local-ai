import { describe, expect, it } from 'vitest';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PERCENT_BASE,
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

const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };
const FAR: Camera = {
  x: UNBOUNDED_PAN_TESTED_EXTENT,
  y: -UNBOUNDED_PAN_TESTED_EXTENT,
  zoom: 1,
};
const VIEWPORT: Size = { width: 1200, height: 800 };
const CENTRE: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

/** Tolerance for "exact" double maths (far below one pixel). */
const EXACT_DIGITS = 6;

function expectXY(actual: { x: number; y: number }, expected: { x: number; y: number }, digits = EXACT_DIGITS): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

/** World point under a screen point; must be invariant under zoomAt. */
function pointerWorld(cam: Camera, screenPoint: Point): Point {
  return screenToWorld(cam, screenPoint);
}

describe('camera.math', () => {
  it('TC-01 panBy at zoom 1 from origin moves content by exactly the pointer delta', () => {
    const after = panBy(ORIGIN, 200, 100);

    // The camera moves opposite to the pointer...
    expectXY(after, { x: -200, y: -100 });
    expect(after.zoom).toBe(1);
    expect(after).not.toBe(ORIGIN);

    // ...so the world point (0,0) lands 200 px right and 100 px down.
    expectXY(worldToScreen(ORIGIN, { x: 0, y: 0 }), { x: 0, y: 0 });
    expectXY(worldToScreen(after, { x: 0, y: 0 }), { x: 200, y: 100 });
  });

  it('TC-02 panBy at ZOOM_MAX far from the origin shifts by delta/zoom exactly', () => {
    const cam: Camera = { ...FAR, zoom: ZOOM_MAX };
    const after = panBy(cam, 200, 100);

    expectXY(after, {
      x: UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX,
      y: -UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX,
    });
    expect(after.zoom).toBe(ZOOM_MAX);

    // Sub-pixel precision survives at the tested extent: one more screen pixel
    // of pointer movement still moves content by exactly one screen pixel.
    const oneMore = panBy(after, 1, 1);
    expect(oneMore).not.toBe(after);
    const before = worldToScreen(after, { x: 0, y: 0 });
    const moved = worldToScreen(oneMore, { x: 0, y: 0 });
    expectXY({ x: moved.x - before.x, y: moved.y - before.y }, { x: 1, y: 1 }, 4);
  });

  it('TC-03 zoomAt keeps the world point under the pointer fixed', () => {
    const p: Point = { x: 300, y: 200 };
    const before = pointerWorld(ORIGIN, p);
    const after = zoomAt(ORIGIN, p, 2);

    expect(after.zoom).toBe(2);
    expectXY(pointerWorld(after, p), before);
  });

  it('TC-04 zoomAt keeps the pointer world point invariant far from the origin', () => {
    const p: Point = { x: 640, y: 400 };
    const before = pointerWorld(FAR, p);
    const after = zoomAt(FAR, p, 1.5);

    expect(after.zoom).toBeCloseTo(1.5, 12);
    expectXY(pointerWorld(after, p), before);
  });

  it('TC-05 zooming out at ZOOM_MIN returns the same camera object', () => {
    const cam: Camera = { x: 120, y: -80, zoom: ZOOM_MIN };
    const after = zoomAt(cam, CENTRE, 1 / ZOOM_STEP_FACTOR);

    expect(after).toBe(cam);
    expectXY(after, { x: cam.x, y: cam.y });
    expect(after.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
  });

  it('TC-06 zooming in at ZOOM_MAX returns the same camera object', () => {
    const cam: Camera = { x: 120, y: -80, zoom: ZOOM_MAX };
    const after = zoomAt(cam, CENTRE, ZOOM_STEP_FACTOR);

    expect(after).toBe(cam);
    expect(after.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  it('TC-07 a viewport resize leaves camera x, y and zoom unchanged', () => {
    const cam: Camera = { x: 123.5, y: -77.25, zoom: 1.75 };
    const small: Size = { width: 800, height: 600 };
    const large: Size = { width: 1920, height: 1080 };

    // The camera holds no viewport coupling: content stays pinned relative to
    // the top-left corner of the board area after a resize.
    const unchanged: Camera = cam;
    expect(unchanged).toBe(cam);
    expectXY(unchanged, { x: 123.5, y: -77.25 });
    expect(unchanged.zoom).toBe(1.75);
    expectXY(screenToWorld(unchanged, { x: 0, y: 0 }), screenToWorld(cam, { x: 0, y: 0 }));
    expectXY(worldToScreen(unchanged, { x: 0, y: 0 }), {
      x: (0 - cam.x) * cam.zoom,
      y: (0 - cam.y) * cam.zoom,
    });

    // Only centre-based operations consult the viewport, and they agree on zoom.
    expect(zoomStep(cam, small, 'in').zoom).toBe(zoomStep(cam, large, 'in').zoom);

    // Reset uses the viewport size only to centre the starting point.
    for (const size of [small, large]) {
      const reset = resetCamera(size);
      expect(reset.zoom).toBe(1);
      expectXY(reset, { x: -size.width / 2, y: -size.height / 2 });
      expectXY(worldToScreen(reset, { x: 0, y: 0 }), { x: size.width / 2, y: size.height / 2 });
    }
  });

  it('TC-08 resetCamera returns to zoom 1 with the starting point centred', () => {
    const cam: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    };
    const after = resetCamera(VIEWPORT);

    expect(after).not.toBe(cam);
    expect(after.zoom).toBe(1);
    expect(after.x).not.toBe(cam.x);
    expect(after.y).not.toBe(cam.y);
    expectXY(after, { x: -VIEWPORT.width / 2, y: -VIEWPORT.height / 2 });
    expectXY(worldToScreen(after, { x: 0, y: 0 }), CENTRE);
  });

  it('TC-09 one step in then one step out returns exactly the starting zoom', () => {
    const inOnce = zoomStep(ORIGIN, VIEWPORT, 'in');
    expect(inOnce.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(inOnce)).toBe(125);

    const back = zoomStep(inOnce, VIEWPORT, 'out');
    expect(back.zoom).toBe(1);
    expect(zoomPercent(back)).toBe(100);

    // The board location at the centre of the board area stayed put.
    expectXY(pointerWorld(inOnce, CENTRE), pointerWorld(ORIGIN, CENTRE));
    expectXY(pointerWorld(back, CENTRE), pointerWorld(ORIGIN, CENTRE));
  });

  it('TC-10 repeated steps in clamp at ZOOM_MAX and disable zoom in', () => {
    let cam: Camera = ORIGIN;
    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'in');
      expect(cam.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    // A further step is a no-op returning the same object.
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);

    const back = zoomStep(cam, VIEWPORT, 'out');
    expect(back.zoom).toBeCloseTo(ZOOM_MAX / ZOOM_STEP_FACTOR, 12);
    expect(canZoomIn(back)).toBe(true);
  });

  it('TC-11 a huge zoom factor clamps and still keeps the pointer invariant', () => {
    const p: Point = { x: 900, y: 120 };
    const before = pointerWorld(ORIGIN, p);

    const clampedIn = zoomAt(ORIGIN, p, 1000);
    expect(clampedIn.zoom).toBe(ZOOM_MAX);
    expectXY(pointerWorld(clampedIn, p), before);

    const clampedOut = zoomAt(ORIGIN, p, 1 / 1000);
    expect(clampedOut.zoom).toBe(ZOOM_MIN);
    expectXY(pointerWorld(clampedOut, p), before);
  });

  it('TC-12 invalid zoom factors leave the camera unchanged and never produce NaN', () => {
    const p: Point = { x: 10, y: 20 };
    const badFactors = [0, -1, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const factor of badFactors) {
      const after = zoomAt(ORIGIN, p, factor);
      expect(after).toBe(ORIGIN);
      expect(Number.isFinite(after.x)).toBe(true);
      expect(Number.isFinite(after.y)).toBe(true);
      expect(Number.isFinite(after.zoom)).toBe(true);
    }
    for (const delta of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(panBy(ORIGIN, delta, delta)).toBe(ORIGIN);
    }
    // A zero-length drag changes nothing.
    expect(panBy(ORIGIN, 0, 0)).toBe(ORIGIN);
  });

  it('dot grid spacing is GRID_SPACING_WORLD world units at every zoom', () => {
    for (const zoom of [ZOOM_MIN, 1, ZOOM_MAX]) {
      const cam: Camera = { x: 0, y: 0, zoom };
      const a = worldToScreen(cam, { x: 0, y: 0 });
      const b = worldToScreen(cam, { x: GRID_SPACING_WORLD, y: GRID_SPACING_WORLD });
      expect(b.x - a.x).toBeCloseTo(GRID_SPACING_WORLD * zoom, 9);
      expect(b.y - a.y).toBeCloseTo(GRID_SPACING_WORLD * zoom, 9);
    }
  });

  it('property check: pointer invariance for 1000 seeded cameras, points and factors', () => {
    let state = 0x9e3779b9;
    const rand = (): number => {
      // Deterministic LCG so the property run is reproducible.
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };

    for (let i = 0; i < 1000; i += 1) {
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const cam: Camera = {
        x: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom,
      };
      const p: Point = { x: rand() * 1920, y: rand() * 1080 };
      const factor = Math.exp((rand() * 2 - 1) * 3);

      const before = pointerWorld(cam, p);
      const after = zoomAt(cam, p, factor);

      expect(after.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expect(Number.isFinite(after.x)).toBe(true);
      expect(Number.isFinite(after.y)).toBe(true);
      expectXY(pointerWorld(after, p), before);
    }
  });

  it('zoomPercent is a whole-number percentage', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(ZOOM_PERCENT_BASE);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });
});
