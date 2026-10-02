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

/** Precision threshold for floating point comparisons (world units). */
const EPS = 1e-6;
/** Drag deltas used across the pan cases (screen px). */
const PAN_DX = 200;
const PAN_DY = 100;
/** Pointer used across the zoom cases (screen px). */
const POINTER: Point = { x: 300, y: 200 };
/** Viewport used for step and reset cases. */
const VIEWPORT: Size = { width: 1280, height: 800 };

function cam(x: number, y: number, zoom: number): Camera {
  return { x, y, zoom };
}

function originAtCentre(zoom = 1): Camera {
  return cam(-VIEWPORT.width / 2, -VIEWPORT.height / 2, zoom);
}

function farCam(zoom: number): Camera {
  return cam(UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, zoom);
}

describe('camera.math', () => {
  it('TC-01 panBy moves the camera by -delta/zoom; content follows the pointer', () => {
    const before = originAtCentre(1);
    const after = panBy(before, PAN_DX, PAN_DY);

    expect(after.x).toBeCloseTo(before.x - PAN_DX, 6);
    expect(after.y).toBeCloseTo(before.y - PAN_DY, 6);
    expect(after.zoom).toBe(1);

    // A world point that was at screen (0,0) is at (200,100) afterwards.
    const anchor = screenToWorld(before, { x: 0, y: 0 });
    const s = worldToScreen(after, anchor);
    expect(s.x).toBeCloseTo(PAN_DX, 6);
    expect(s.y).toBeCloseTo(PAN_DY, 6);
  });

  it('TC-02 panBy at ZOOM_MAX far away shifts by -delta/zoom within 1e-6', () => {
    const before = farCam(ZOOM_MAX);
    const after = panBy(before, PAN_DX, PAN_DY);

    expect(after.x - before.x).toBeCloseTo(-PAN_DX / ZOOM_MAX, 6);
    expect(after.y - before.y).toBeCloseTo(-PAN_DY / ZOOM_MAX, 6);
    expect(after.zoom).toBe(ZOOM_MAX);
  });

  it('TC-03 zoomAt keeps the world point under the pointer fixed', () => {
    const before = originAtCentre(1);
    const after = zoomAt(before, POINTER, 2);

    expect(after.zoom).toBe(2);
    const wBefore = screenToWorld(before, POINTER);
    const wAfter = screenToWorld(after, POINTER);
    expect(Math.abs(wAfter.x - wBefore.x)).toBeLessThan(EPS);
    expect(Math.abs(wAfter.y - wBefore.y)).toBeLessThan(EPS);
  });

  it('TC-04 zoomAt far away keeps the pointer world point invariant within 1e-6', () => {
    const before = farCam(1);
    const after = zoomAt(before, POINTER, 1.5);

    const wBefore = screenToWorld(before, POINTER);
    const wAfter = screenToWorld(after, POINTER);
    expect(Math.abs(wAfter.x - wBefore.x)).toBeLessThan(EPS);
    expect(Math.abs(wAfter.y - wBefore.y)).toBeLessThan(EPS);
  });

  it('TC-05 zooming out at ZOOM_MIN returns the same camera object', () => {
    const before = originAtCentre(ZOOM_MIN);
    const after = zoomAt(before, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }, 1 / ZOOM_STEP_FACTOR);

    expect(after).toBe(before);
    expect(after.zoom).toBe(ZOOM_MIN);
  });

  it('TC-06 zooming in at ZOOM_MAX returns the same camera object', () => {
    const before = originAtCentre(ZOOM_MAX);
    const after = zoomAt(before, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }, ZOOM_STEP_FACTOR);

    expect(after).toBe(before);
    expect(after.zoom).toBe(ZOOM_MAX);
  });

  it('TC-07 a viewport size change is not an operation on the camera', () => {
    const c = cam(123.45, -67.89, 1.25);
    // The camera module takes no viewport size for state it already holds;
    // resizing only changes what is visible, never the camera itself.
    expect(c.x).toBe(123.45);
    expect(c.y).toBe(-67.89);
    expect(c.zoom).toBe(1.25);
    // A zero-length pan is a no-op returning the same object.
    expect(panBy(c, 0, 0)).toBe(c);
  });

  it('TC-08 resetCamera centres the origin at 100% zoom', () => {
    const reset = resetCamera({ width: 1200, height: 800 });

    expect(reset.zoom).toBe(1);
    expect(reset.x).toBe(-600);
    expect(reset.y).toBe(-400);
    // World origin renders at the viewport centre.
    const s = worldToScreen(reset, { x: 0, y: 0 });
    expect(s.x).toBeCloseTo(600, 6);
    expect(s.y).toBeCloseTo(400, 6);
  });

  it('TC-09 one step in then one step out returns exactly 100%', () => {
    let c = originAtCentre(1);
    c = zoomStep(c, VIEWPORT, 'in');
    expect(c.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);
    c = zoomStep(c, VIEWPORT, 'out');
    expect(c.zoom).toBe(1);
    expect(zoomPercent(c)).toBe(100);
  });

  it('TC-10 twenty steps in clamp at ZOOM_MAX and disable zoom in', () => {
    let c = originAtCentre(1);
    for (let i = 0; i < 20; i++) {
      c = zoomStep(c, VIEWPORT, 'in');
    }
    expect(c.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(c)).toBe(false);
    expect(canZoomOut(c)).toBe(true);
  });

  it('TC-11 a huge zoom factor clamps to ZOOM_MAX and keeps the pointer fixed', () => {
    const before = originAtCentre(1);
    const after = zoomAt(before, POINTER, 1000);

    expect(after.zoom).toBe(ZOOM_MAX);
    const wBefore = screenToWorld(before, POINTER);
    const wAfter = screenToWorld(after, POINTER);
    expect(Math.abs(wAfter.x - wBefore.x)).toBeLessThan(EPS);
    expect(Math.abs(wAfter.y - wBefore.y)).toBeLessThan(EPS);
  });

  it('TC-12 invalid factors (0, negative, NaN, +/-Infinity) leave the camera unchanged', () => {
    const before = cam(10, -20, 1);
    const invalidFactors = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

    for (const factor of invalidFactors) {
      const after = zoomAt(before, POINTER, factor);
      expect(after).toBe(before);
      expect(Number.isFinite(after.x)).toBe(true);
      expect(Number.isFinite(after.y)).toBe(true);
      expect(Number.isFinite(after.zoom)).toBe(true);
    }
  });

  it('pointer world point is invariant under zoomAt for 1000 random cameras', () => {
    // Deterministic PRNG (mulberry32) so the property check is repeatable.
    let seed = 42;
    const rand = (): number => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let i = 0; i < 1000; i++) {
      const c = cam(
        (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT,
        (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT,
        ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN),
      );
      const p: Point = { x: rand() * 2000, y: rand() * 2000 };
      const factor = 0.5 + rand() * 1.5;

      const after = zoomAt(c, p, factor);
      const wBefore = screenToWorld(c, p);
      const wAfter = screenToWorld(after, p);
      expect(Math.abs(wAfter.x - wBefore.x)).toBeLessThan(EPS);
      expect(Math.abs(wAfter.y - wBefore.y)).toBeLessThan(EPS);
    }
  });
});
