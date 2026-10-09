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
  CAMERA_EPSILON,
  GRID_SPACING_WORLD,
  PERCENT,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const origin: Camera = { x: 0, y: 0, zoom: 1 };
const midViewport: Size = { width: 1200, height: 800 };
const midCentre: Point = { x: midViewport.width / 2, y: midViewport.height / 2 };
const far: Camera = {
  x: UNBOUNDED_PAN_TESTED_EXTENT,
  y: UNBOUNDED_PAN_TESTED_EXTENT,
  zoom: ZOOM_MAX,
};

const near = (actual: number, expected: number, epsilon = CAMERA_EPSILON) =>
  Math.abs(actual - expected) <= epsilon;

/** Deterministic PRNG so the property check is reproducible. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe('camera.math', () => {
  it('TC-01: panBy moves the camera by the pointer delta at zoom 1', () => {
    const after = panBy(origin, 200, 100);
    expect(after.x).toBeCloseTo(-200, 9);
    expect(after.y).toBeCloseTo(-100, 9);
    // The world point (0,0) that was at screen (0,0) is now at screen (200,100).
    const moved = worldToScreen(after, { x: 0, y: 0 });
    expect(moved.x).toBeCloseTo(200, 9);
    expect(moved.y).toBeCloseTo(100, 9);
    expect(worldToScreen(after, { x: GRID_SPACING_WORLD, y: GRID_SPACING_WORLD }).x).toBeCloseTo(
      200 + GRID_SPACING_WORLD,
      9,
    );
  });

  it('TC-02: panBy is exact at ZOOM_MAX far from the start', () => {
    const after = panBy(far, 200, 100);
    expect(near(after.x, UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX)).toBe(true);
    expect(near(after.y, UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX)).toBe(true);
    expect(after.zoom).toBe(ZOOM_MAX);
    // Sub-pixel precision survives: a 1 px drag moves 1/zoom world units.
    const tiny = panBy(far, 1, 0);
    expect(near(tiny.x, far.x - 1 / ZOOM_MAX)).toBe(true);
  });

  it('TC-03: zoomAt keeps the world point under the pointer fixed', () => {
    const point: Point = { x: 300, y: 200 };
    const before = screenToWorld(origin, point);
    const after = zoomAt(origin, point, 2);
    expect(after.zoom).toBeCloseTo(2, 9);
    const afterPoint = screenToWorld(after, point);
    expect(near(afterPoint.x, before.x)).toBe(true);
    expect(near(afterPoint.y, before.y)).toBe(true);
  });

  it('TC-04: zoomAt keeps the pointer point invariant far from the start', () => {
    const farCam: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    };
    const point: Point = { x: 640, y: 400 };
    const before = screenToWorld(farCam, point);
    const after = zoomAt(farCam, point, 1.5);
    const afterPoint = screenToWorld(after, point);
    expect(near(afterPoint.x, before.x)).toBe(true);
    expect(near(afterPoint.y, before.y)).toBe(true);
  });

  it('TC-05: zooming out at ZOOM_MIN returns the same camera object', () => {
    const atMin: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const after = zoomAt(atMin, midCentre, 1 / ZOOM_STEP_FACTOR);
    expect(after).toBe(atMin);
    expect(after.x).toBe(atMin.x);
    expect(after.y).toBe(atMin.y);
    expect(canZoomOut(atMin)).toBe(false);
    expect(canZoomIn(atMin)).toBe(true);
    expect(panBy(atMin, 5, 5).zoom).toBe(ZOOM_MIN);
  });

  it('TC-06: zooming in at ZOOM_MAX returns the same camera object', () => {
    const atMax: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const after = zoomAt(atMax, midCentre, ZOOM_STEP_FACTOR);
    expect(after).toBe(atMax);
    expect(after.x).toBe(atMax.x);
    expect(after.y).toBe(atMax.y);
    expect(canZoomIn(atMax)).toBe(false);
    expect(canZoomOut(atMax)).toBe(true);
  });

  it('TC-07: a viewport resize leaves the camera untouched', () => {
    // Resize is not user input to the camera: camera.math holds no viewport state.
    const cam: Camera = { x: -123.5, y: 45.25, zoom: 1.5 };
    const small: Size = { width: 640, height: 480 };
    const large: Size = { width: 1920, height: 1080 };
    expect(panBy(cam, 0, 0)).toBe(cam);
    expect(panBy(cam, 0, 0).x).toBe(cam.x);
    expect(panBy(cam, 0, 0).y).toBe(cam.y);
    expect(zoomAt(cam, { x: small.width / 2, y: small.height / 2 }, 1)).toBe(cam);
    // The same camera is valid for both viewport sizes: nothing re-bases x/y.
    expect(worldToScreen(cam, { x: cam.x + 1, y: cam.y + 1 }).x).toBeCloseTo(cam.zoom, 9);
    expect(large.width).toBeGreaterThan(small.width);
  });

  it('TC-08: resetCamera centres the board start point at 100%', () => {
    const viewport: Size = { width: 1200, height: 800 };
    const after = resetCamera(viewport);
    expect(after.zoom).toBe(1);
    expect(after.x).toBeCloseTo(-600, 9);
    expect(after.y).toBeCloseTo(-400, 9);
    const centre = worldToScreen(after, { x: 0, y: 0 });
    expect(centre.x).toBeCloseTo(viewport.width / 2, 9);
    expect(centre.y).toBeCloseTo(viewport.height / 2, 9);
    // Works from far away and at maximum zoom.
    expect(resetCamera(viewport)).toEqual(resetCamera(viewport));
    expect(zoomPercent(resetCamera(viewport))).toBe(100);
  });

  it('TC-09: one step in then one step out returns exactly the starting zoom', () => {
    const inZoom = zoomStep(origin, midViewport, 'in');
    expect(inZoom.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);
    expect(zoomPercent(inZoom)).toBe(Math.round(ZOOM_STEP_FACTOR * PERCENT));
    const back = zoomStep(inZoom, midViewport, 'out');
    expect(back.zoom).toBe(1);
    expect(zoomPercent(back)).toBe(PERCENT);
    // Centre of the board area stays at the same screen position.
    const centreWorld = screenToWorld(origin, midCentre);
    const afterWorld = screenToWorld(inZoom, midCentre);
    expect(near(afterWorld.x, centreWorld.x)).toBe(true);
    expect(near(afterWorld.y, centreWorld.y)).toBe(true);
  });

  it('TC-10: repeated steps in clamp at ZOOM_MAX and disable zoom in', () => {
    let cam: Camera = origin;
    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, midViewport, 'in');
    }
    expect(cam.zoom).toBeCloseTo(ZOOM_MAX, 9);
    expect(canZoomIn(cam)).toBe(false);
    const stopped = zoomStep(cam, midViewport, 'in');
    expect(stopped).toBe(cam);
    // Zooming back the other way is possible again.
    expect(canZoomIn(zoomStep(cam, midViewport, 'out'))).toBe(true);
  });

  it('TC-11: an enormous zoom factor clamps and keeps pointer invariance', () => {
    const point: Point = { x: 120, y: 340 };
    const before = screenToWorld(origin, point);
    const after = zoomAt(origin, point, 1000);
    expect(after.zoom).toBe(ZOOM_MAX);
    const afterPoint = screenToWorld(after, point);
    expect(near(afterPoint.x, before.x)).toBe(true);
    expect(near(afterPoint.y, before.y)).toBe(true);
    const out = zoomAt(origin, point, 1 / 1000);
    expect(out.zoom).toBe(ZOOM_MIN);
    const outPoint = screenToWorld(out, point);
    const beforeOut = screenToWorld(origin, point);
    expect(near(outPoint.x, beforeOut.x)).toBe(true);
    expect(near(outPoint.y, beforeOut.y)).toBe(true);
  });

  it('TC-12: invalid zoom factors return the input camera unchanged, without NaN', () => {
    const point: Point = { x: 10, y: 20 };
    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const after = zoomAt(origin, point, factor);
      expect(after).toBe(origin);
      expect(Number.isNaN(after.x)).toBe(false);
      expect(Number.isNaN(after.y)).toBe(false);
      expect(Number.isNaN(after.zoom)).toBe(false);
    }
    // Invalid pan deltas are ignored the same way.
    expect(panBy(origin, Number.NaN, 5)).toBe(origin);
    expect(panBy(origin, 0, 0)).toBe(origin);
    expect(Number.isNaN(zoomPercent(origin))).toBe(false);
  });

  it('TC-13 property: pointer invariance holds for 1,000 random cameras', () => {
    const random = makeRandom(42);
    for (let i = 0; i < 1_000; i += 1) {
      const cam: Camera = {
        x: (random() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (random() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MIN * (ZOOM_MAX / ZOOM_MIN) ** random(),
      };
      const point: Point = { x: random() * 1920, y: random() * 1080 };
      const factor = Math.exp((random() * 2 - 1) * 3);
      const before = screenToWorld(cam, point);
      const after = zoomAt(cam, point, factor);
      const afterPoint = screenToWorld(after, point);
      // Compare in screen space (sub-pixel) as well as world space.
      const worldError = Math.abs(afterPoint.x - before.x) + Math.abs(afterPoint.y - before.y);
      expect(worldError * cam.zoom).toBeLessThan(1);
      expect(near(afterPoint.x, before.x, CAMERA_EPSILON * Math.max(1, Math.abs(before.x)))).toBe(
        true,
      );
      expect(after.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }
  });
});
