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
  GRID_SPACING_WORLD,
  PERCENT,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const EPS = 1e-6;
const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };
const VIEWPORT: Size = { width: 1200, height: 800 };
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;

function expectClose(actual: number, expected: number, eps = EPS) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(eps);
}

function expectCameraClose(actual: Camera, expected: Camera, eps = EPS) {
  expectClose(actual.x, expected.x, eps);
  expectClose(actual.y, expected.y, eps);
  expectClose(actual.zoom, expected.zoom, eps);
}

// Deterministic RNG (mulberry32) for the property check.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('camera.math', () => {
  it('TC-01 panBy at zoom 1 from origin moves camera by (-dx,-dy) and dot follows pointer', () => {
    const after = panBy(ORIGIN, 200, 100);
    expectCameraClose(after, { x: -200, y: -100, zoom: 1 });
    // The world origin dot started at screen (0,0) and must be at (200,100).
    expectClose(worldToScreen(ORIGIN, { x: 0, y: 0 }).x, 0);
    expectClose(worldToScreen(ORIGIN, { x: 0, y: 0 }).y, 0);
    const dot = worldToScreen(after, { x: 0, y: 0 });
    expectClose(dot.x, 200);
    expectClose(dot.y, 100);
  });

  it('TC-02 panBy at ZOOM_MAX far away shifts by world = screen/zoom, exact', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const after = panBy(cam, 200, 100);
    expectCameraClose(after, { x: FAR - 200 / ZOOM_MAX, y: FAR - 100 / ZOOM_MAX, zoom: ZOOM_MAX });
    expectClose(after.x, FAR - 50);
    expectClose(after.y, FAR - 25);
  });

  it('TC-03 zoomAt keeps the world point under the pointer fixed (origin, factor 2)', () => {
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN, p);
    const after = zoomAt(ORIGIN, p, 2);
    expect(after.zoom).toBeCloseTo(2, 10);
    const afterWorld = screenToWorld(after, p);
    expectClose(afterWorld.x, before.x);
    expectClose(afterWorld.y, before.y);
  });

  it('TC-04 zoomAt keeps the pointer world point invariant far away (1e6, factor 1.5)', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: 1 };
    const p: Point = { x: 640, y: 400 };
    const before = screenToWorld(cam, p);
    const after = zoomAt(cam, p, 1.5);
    const afterWorld = screenToWorld(after, p);
    expectClose(afterWorld.x, before.x);
    expectClose(afterWorld.y, before.y);
  });

  it('TC-05 at ZOOM_MIN, zooming further out returns the same object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const after = zoomAt(cam, centre, 1 / ZOOM_STEP_FACTOR);
    expect(after).toBe(cam);
    expect(after.zoom).toBe(ZOOM_MIN);
  });

  it('TC-06 at ZOOM_MAX, zooming further in returns the same object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const after = zoomAt(cam, centre, ZOOM_STEP_FACTOR);
    expect(after).toBe(cam);
    expect(after.zoom).toBe(ZOOM_MAX);
  });

  it('TC-07 viewport resize leaves the camera unchanged (world anchored to top-left)', () => {
    const cam: Camera = { x: 123, y: 456, zoom: 2 };
    // A zero-delta pan is the identity and returns the same object.
    expect(panBy(cam, 0, 0)).toBe(cam);
    // The world coordinate shown at the viewport top-left is camera.xy
    // regardless of viewport size, so growing the window does not move content
    // relative to the top-left corner.
    const small = screenToWorld(cam, { x: 0, y: 0 });
    expectClose(small.x, cam.x);
    expectClose(small.y, cam.y);
  });

  it('TC-08 resetCamera centring places world origin at viewport centre', () => {
    const cam = resetCamera(VIEWPORT);
    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(-VIEWPORT.width / 2);
    expect(cam.y).toBe(-VIEWPORT.height / 2);
    const originScreen = worldToScreen(cam, { x: 0, y: 0 });
    expectClose(originScreen.x, VIEWPORT.width / 2);
    expectClose(originScreen.y, VIEWPORT.height / 2);
  });

  it('TC-09 one step in then one step out returns exactly 1.0 (step snapping)', () => {
    const cam1 = zoomStep(ORIGIN, VIEWPORT, 'in');
    expect(cam1.zoom).toBe(ZOOM_STEP_FACTOR); // 1.25
    const cam2 = zoomStep(cam1, VIEWPORT, 'out');
    expect(cam2.zoom).toBe(1);
    expect(zoomPercent(cam2)).toBe(1 * PERCENT);
  });

  it('TC-10 20 steps in clamp at ZOOM_MAX and canZoomIn becomes false', () => {
    let cam: Camera = ORIGIN;
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  it('TC-11 huge zoom factor clamps to ZOOM_MAX and keeps the pointer invariant', () => {
    const p: Point = { x: 400, y: 300 };
    const before = screenToWorld(ORIGIN, p);
    const after = zoomAt(ORIGIN, p, 1000);
    expect(after.zoom).toBe(ZOOM_MAX);
    const afterWorld = screenToWorld(after, p);
    expectClose(afterWorld.x, before.x);
    expectClose(afterWorld.y, before.y);
  });

  it('TC-12 invalid zoom factors return the input camera with no NaN', () => {
    const p: Point = { x: 10, y: 10 };
    for (const bad of [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const after = zoomAt(ORIGIN, p, bad);
      expect(after).toBe(ORIGIN);
      expect(Number.isFinite(after.x)).toBe(true);
      expect(Number.isFinite(after.y)).toBe(true);
      expect(Number.isFinite(after.zoom)).toBe(true);
    }
  });

  it('property: pointer world point is invariant under zoomAt for 1000 seeded cases', () => {
    const rand = mulberry32(123456789);
    for (let i = 0; i < 1000; i++) {
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const cam: Camera = {
        x: (rand() - 0.5) * 2 * FAR,
        y: (rand() - 0.5) * 2 * FAR,
        zoom,
      };
      const p: Point = { x: rand() * 1280, y: rand() * 800 };
      const factor = Math.exp((rand() - 0.5) * 2); // roughly e^-1..e^1
      const before = screenToWorld(cam, p);
      const after = zoomAt(cam, p, factor);
      const afterWorld = screenToWorld(after, p);
      // When clamped the zoom equals a limit but the pointer invariant still holds.
      expect(Math.abs(afterWorld.x - before.x)).toBeLessThan(1e-6);
      expect(Math.abs(afterWorld.y - before.y)).toBeLessThan(1e-6);
      // Zoom always stays within limits.
      expect(after.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }
  });

  it('grid spacing is used for pan precision (config sanity)', () => {
    // The dot grid is drawn from camera position modulo GRID_SPACING_WORLD, so a
    // pan of exactly one world grid cell must move a dot by GRID_SPACING_WORLD px
    // at zoom 1.
    const after = panBy(ORIGIN, GRID_SPACING_WORLD, GRID_SPACING_WORLD);
    expectClose(worldToScreen(after, { x: 0, y: 0 }).x, GRID_SPACING_WORLD);
    expectClose(worldToScreen(after, { x: 0, y: 0 }).y, GRID_SPACING_WORLD);
  });
});
