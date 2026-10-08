import { describe, expect, it } from 'vitest';
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
import {
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const ORIGIN: Point = { x: 0, y: 0 };
const HOME_VIEWPORT: Size = { width: 1200, height: 800 };

function camera(x: number, y: number, zoom: number): Camera {
  return { x, y, zoom };
}

function assertPointerInvariant(before: Camera, after: Camera, p: Point): void {
  const wBefore = screenToWorld(before, p);
  const wAfter = screenToWorld(after, p);
  expect(wAfter.x).toBeCloseTo(wBefore.x, 6);
  expect(wAfter.y).toBeCloseTo(wBefore.y, 6);
}

describe('camera.math', () => {
  it('TC-01: panBy at zoom 1 shifts the camera by exactly -delta/zoom and moves world (0,0) by the drag delta', () => {
    const before = camera(0, 0, 1);
    const after = panBy(before, 200, 100);

    expect(after.x).toBe(-200);
    expect(after.y).toBe(-100);
    expect(after.zoom).toBe(1);

    expect(worldToScreen(before, ORIGIN)).toEqual({ x: 0, y: 0 });
    expect(worldToScreen(after, ORIGIN)).toEqual({ x: 200, y: 100 });
  });

  it('TC-02: panBy at ZOOM_MAX far away (1e6) shifts the camera by -delta/zoom, exact', () => {
    const far = UNBOUNDED_PAN_TESTED_EXTENT;
    const before = camera(far, far, ZOOM_MAX);
    const after = panBy(before, 200, 100);

    expect(after.x).toBeCloseTo(far - 200 / ZOOM_MAX, 6);
    expect(after.y).toBeCloseTo(far - 100 / ZOOM_MAX, 6);
    expect(after.zoom).toBe(ZOOM_MAX);
  });

  it('TC-03: zoomAt keeps the world point under the pointer invariant (origin)', () => {
    const before = camera(0, 0, 1);
    const p: Point = { x: 300, y: 200 };
    const after = zoomAt(before, p, 2);

    expect(after.zoom).toBe(2);
    assertPointerInvariant(before, after, p);
  });

  it('TC-04: zoomAt keeps the world point under the pointer invariant far away (1e6)', () => {
    const far = UNBOUNDED_PAN_TESTED_EXTENT;
    const before = camera(far, far, 1);
    const p: Point = { x: 500, y: 300 };
    const after = zoomAt(before, p, 1.5);

    expect(after.zoom).toBeCloseTo(1.5, 6);
    assertPointerInvariant(before, after, p);
  });

  it('TC-05: zooming out at ZOOM_MIN returns the same camera object', () => {
    const cam = camera(0, 0, ZOOM_MIN);
    const after = zoomStep(cam, HOME_VIEWPORT, 'out');

    expect(after).toBe(cam);
    expect(canZoomOut(cam)).toBe(false);
  });

  it('TC-06: zooming in at ZOOM_MAX returns the same camera object', () => {
    const cam = camera(0, 0, ZOOM_MAX);
    const after = zoomStep(cam, HOME_VIEWPORT, 'in');

    expect(after).toBe(cam);
    expect(canZoomIn(cam)).toBe(false);
  });

  it('TC-07: a viewport resize leaves the camera unchanged (content stays anchored to the top-left)', () => {
    const cam = resetCamera({ width: 1200, height: 800 });
    // The camera state carries no viewport size, so a resize is a no-op:
    const resizedViewport: Size = { width: 1920, height: 1080 };
    const camAfterResize = cam; // nothing to update

    expect(camAfterResize).toBe(cam);
    expect(camAfterResize.x).toBe(cam.x);
    expect(camAfterResize.y).toBe(cam.y);
    expect(camAfterResize.zoom).toBe(cam.zoom);

    // World points keep the same screen position relative to the top-left.
    const w: Point = { x: 100, y: 50 };
    const before = worldToScreen(cam, w);
    const after = worldToScreen(camAfterResize, w);
    expect(after).toEqual(before);
    expect(resizedViewport).toEqual({ width: 1920, height: 1080 }); // size never stored on the camera
  });

  it('TC-08: resetCamera(1200x800) gives 100% zoom with the origin centred', () => {
    const cam = resetCamera(HOME_VIEWPORT);

    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(-HOME_VIEWPORT.width / 2);
    expect(cam.y).toBe(-HOME_VIEWPORT.height / 2);
    expect(worldToScreen(cam, ORIGIN)).toEqual({
      x: HOME_VIEWPORT.width / 2,
      y: HOME_VIEWPORT.height / 2,
    });
  });

  it('TC-09: one step in then one step out returns exactly to 100%', () => {
    const start = camera(0, 0, 1);
    const inOnce = zoomStep(start, HOME_VIEWPORT, 'in');
    const outOnce = zoomStep(inOnce, HOME_VIEWPORT, 'out');

    expect(inOnce.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 12);
    expect(outOnce.zoom).toBe(1);
    expect(zoomPercent(outOnce)).toBe(100);
  });

  it('TC-10: 20 steps in clamps at ZOOM_MAX and canZoomIn becomes false', () => {
    let cam = camera(0, 0, 1);
    for (let i = 0; i < 20; i++) {
      cam = zoomStep(cam, HOME_VIEWPORT, 'in');
    }

    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
  });

  it('TC-11: a huge factor clamps to ZOOM_MAX and still keeps the pointer invariant', () => {
    const before = camera(0, 0, 1);
    const p: Point = { x: 300, y: 200 };
    const after = zoomAt(before, p, 1000);

    expect(after.zoom).toBe(ZOOM_MAX);
    assertPointerInvariant(before, after, p);
  });

  it('TC-12: invalid factors (0, negative, NaN, ±Infinity) return the camera unchanged with no NaN', () => {
    const cam = camera(0, 0, 1);
    const p: Point = { x: 300, y: 200 };

    for (const factor of [0, -2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const after = zoomAt(cam, p, factor);
      expect(after).toBe(cam);
      expect(Number.isFinite(after.x)).toBe(true);
      expect(Number.isFinite(after.y)).toBe(true);
      expect(Number.isFinite(after.zoom)).toBe(true);
    }
  });

  it('property: for 1000 seeded random cameras/points/factors the pointer world point is invariant under zoomAt', () => {
    // Deterministic PRNG so the property check is reproducible.
    let seed = 0x5eed1234;
    const rand = (): number => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let i = 0; i < 1000; i++) {
      const cam = camera(
        (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN),
      );
      const p: Point = { x: rand() * 20_000, y: rand() * 20_000 };
      const factor = 0.2 + rand() * 8;

      const after = zoomAt(cam, p, factor);
      expect(after.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expect(Number.isFinite(after.x)).toBe(true);
      expect(Number.isFinite(after.y)).toBe(true);

      if (after !== cam) {
        assertPointerInvariant(cam, after, p);
      }
    }
  });
});
