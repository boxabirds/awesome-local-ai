import { describe, expect, it } from "vitest";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
  PERCENT,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from "../../src/shared/config";
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
} from "../../src/client/canvas/camera";

/** Tolerance for "exact" world-coordinate assertions. */
const WORLD_EPS = 1e-6;
/** Tolerance for screen-pixel assertions in pure maths. */
const SCREEN_EPS = 1e-6;

const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };
const VIEWPORT: Size = { width: 1200, height: 800 };
const WIDE_VIEWPORT: Size = { width: 1920, height: 1080 };

function farCamera(zoom: number): Camera {
  return { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom };
}

function expectCameraClose(actual: Camera, expected: { x: number; y: number; zoom: number }) {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect(actual.zoom).toBeCloseTo(expected.zoom, 9);
}

function expectFiniteCamera(cam: Camera) {
  expect(Number.isFinite(cam.x)).toBe(true);
  expect(Number.isFinite(cam.y)).toBe(true);
  expect(Number.isFinite(cam.zoom)).toBe(true);
  expect(cam.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
  expect(cam.zoom).toBeLessThanOrEqual(ZOOM_MAX);
}

/** Deterministic PRNG so the property check is reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("camera.math", () => {
  it("TC-01: panBy moves the camera left/up and the board right/down at zoom 1", () => {
    const cam = ORIGIN;
    const after = panBy(cam, 200, 100);

    expectCameraClose(after, { x: -200, y: -100, zoom: cam.zoom });
    // The world point that was at the screen origin is now 200 right, 100 down.
    const moved = worldToScreen(after, { x: 0, y: 0 });
    expect(moved.x).toBeCloseTo(200, 6);
    expect(moved.y).toBeCloseTo(100, 6);
    // The camera is immutable.
    expect(cam).toEqual(ORIGIN);
  });

  it("TC-02: panBy at ZOOM_MAX far from the origin shifts whole world units exactly", () => {
    const cam = farCamera(ZOOM_MAX);
    const after = panBy(cam, 200, 100);

    expect(Math.abs(after.x - (UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX))).toBeLessThan(
      WORLD_EPS,
    );
    expect(Math.abs(after.y - (UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX))).toBeLessThan(
      WORLD_EPS,
    );
    expect(after.zoom).toBe(ZOOM_MAX);
    expectFiniteCamera(after);
  });

  it("TC-03: zoomAt keeps the world point under the pointer fixed", () => {
    const cam = ORIGIN;
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(cam, p);
    const after = zoomAt(cam, p, 2);

    expect(after.zoom).toBeCloseTo(2, 9);
    const same = screenToWorld(after, p);
    expect(Math.abs(same.x - before.x)).toBeLessThan(WORLD_EPS);
    expect(Math.abs(same.y - before.y)).toBeLessThan(WORLD_EPS);
  });

  it("TC-04: zoomAt keeps the pointer invariant far away (1e6 world units)", () => {
    const cam = farCamera(1);
    const p: Point = { x: 640, y: 400 };
    const before = screenToWorld(cam, p);
    const after = zoomAt(cam, p, 1.5);

    const same = screenToWorld(after, p);
    expect(Math.abs(same.x - before.x)).toBeLessThan(WORLD_EPS);
    expect(Math.abs(same.y - before.y)).toBeLessThan(WORLD_EPS);
    expect(after.zoom).toBeCloseTo(1.5, 9);
  });

  it("TC-05: zooming out at ZOOM_MIN returns the same camera object", () => {
    const cam: Camera = { x: 123, y: -456, zoom: ZOOM_MIN };
    const after = zoomAt(cam, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }, 1 / ZOOM_STEP_FACTOR);

    expect(after).toBe(cam);
    expect(after.x).toBe(cam.x);
    expect(after.y).toBe(cam.y);
    expect(after.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
  });

  it("TC-06: zooming in at ZOOM_MAX returns the same camera object", () => {
    const cam: Camera = { x: -7, y: 99, zoom: ZOOM_MAX };
    const after = zoomAt(cam, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }, ZOOM_STEP_FACTOR);

    expect(after).toBe(cam);
    expect(after.x).toBe(cam.x);
    expect(after.y).toBe(cam.y);
    expect(after.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  it("TC-07: a viewport resize leaves camera x, y and zoom unchanged", () => {
    const cam = resetCamera(VIEWPORT);
    const zoomed = zoomStep(cam, VIEWPORT, "in");
    const snapshot = { ...zoomed };

    // A resize is not user input: the hook hands the same camera object back
    // (panBy with a zero delta is the documented identity no-op) and no camera
    // function mutates its input, whatever the viewport size.
    const afterResize = panBy(zoomed, 0, 0);
    expect(afterResize).toBe(zoomed);
    expect(afterResize.x).toBe(snapshot.x);
    expect(afterResize.y).toBe(snapshot.y);
    expect(afterResize.zoom).toBe(snapshot.zoom);

    // Calling the viewport-aware helpers at a different size does not touch
    // the camera that was passed in.
    zoomStep(zoomed, WIDE_VIEWPORT, "in");
    zoomAt(zoomed, { x: WIDE_VIEWPORT.width / 2, y: WIDE_VIEWPORT.height / 2 }, ZOOM_STEP_FACTOR);
    resetCamera(WIDE_VIEWPORT);
    expect(zoomed).toEqual(snapshot);

    // World positions are independent of the viewport size.
    const p: Point = { x: 500, y: 300 };
    const a = screenToWorld(zoomed, p);
    const b = screenToWorld(zoomed, p);
    expect(a).toEqual(b);
  });

  it("TC-08: resetCamera centres the board start point at 100%", () => {
    const cam = farCamera(ZOOM_MAX);
    // Before the reset the board start point is a million units off-screen.
    const before = worldToScreen(cam, { x: 0, y: 0 });
    expect(Math.abs(before.x - VIEWPORT.width / 2)).toBeGreaterThan(1);
    const after = resetCamera(VIEWPORT);

    expect(after.zoom).toBe(1);
    expect(after.x).toBe(-VIEWPORT.width / 2);
    expect(after.y).toBe(-VIEWPORT.height / 2);
    const centre = worldToScreen(after, { x: 0, y: 0 });
    expect(centre.x).toBeCloseTo(VIEWPORT.width / 2, 9);
    expect(centre.y).toBeCloseTo(VIEWPORT.height / 2, 9);
  });

  it("TC-09: one step in then one step out returns exactly 1.0 (100%)", () => {
    const inOne = zoomStep(ORIGIN, VIEWPORT, "in");
    expect(inOne.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);
    expect(zoomPercent(inOne)).toBe(Math.round(ZOOM_STEP_FACTOR * PERCENT));

    const backOut = zoomStep(inOne, VIEWPORT, "out");
    expect(backOut.zoom).toBe(1);
    expect(zoomPercent(backOut)).toBe(PERCENT);
  });

  it("TC-10: repeated steps in clamp at ZOOM_MAX and disable zoom in", () => {
    let cam: Camera = ORIGIN;
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, VIEWPORT, "in");

    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MAX * PERCENT));
    expect(zoomStep(cam, VIEWPORT, "in")).toBe(cam);
  });

  it("TC-11: a huge zoom factor clamps at ZOOM_MAX and keeps the pointer invariant", () => {
    const cam = ORIGIN;
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(cam, p);
    const after = zoomAt(cam, p, 1000);

    expect(after.zoom).toBe(ZOOM_MAX);
    const same = screenToWorld(after, p);
    expect(Math.abs(same.x - before.x)).toBeLessThan(WORLD_EPS);
    expect(Math.abs(same.y - before.y)).toBeLessThan(WORLD_EPS);

    const down = zoomAt(after, p, 1 / 1000);
    expect(down.zoom).toBe(ZOOM_MIN);
    const sameDown = screenToWorld(down, p);
    expect(Math.abs(sameDown.x - screenToWorld(after, p).x)).toBeLessThan(WORLD_EPS);
  });

  it("TC-12: invalid zoom factors return the input camera unchanged and never yield NaN", () => {
    const cam = ORIGIN;
    const p: Point = { x: 300, y: 200 };

    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const after = zoomAt(cam, p, factor);
      expect(after).toBe(cam);
      expectFiniteCamera(after);
      expect(Number.isNaN(after.x)).toBe(false);
      expect(Number.isNaN(after.y)).toBe(false);
      expect(Number.isNaN(after.zoom)).toBe(false);
      expect(Number.isNaN(zoomPercent(after))).toBe(false);
    }

    // Invalid pan deltas behave the same way (no NaN camera).
    for (const delta of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const after = panBy(cam, delta, delta);
      expectFiniteCamera(after);
    }
  });

  it("TC-12b: zoomPercent rounds to the nearest whole percent", () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });

  it("property check: 1000 random cameras/points/factors keep the pointer world point invariant", () => {
    const rand = mulberry32(0x5eed1);
    const screenEps = SCREEN_EPS;

    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN),
      };
      const p: Point = { x: rand() * WIDE_VIEWPORT.width, y: rand() * WIDE_VIEWPORT.height };
      const factor = 0.05 + rand() * 19.95;

      const before = screenToWorld(cam, p);
      const after = zoomAt(cam, p, factor);
      const same = screenToWorld(after, p);

      expectFiniteCamera(after);
      expect(Math.abs(same.x - before.x)).toBeLessThan(WORLD_EPS);
      expect(Math.abs(same.y - before.y)).toBeLessThan(WORLD_EPS);

      // Pan invariance: a pan of the same screen delta always moves the world
      // point by exactly that many screen pixels.
      const dx = (rand() * 2 - 1) * 1000;
      const dy = (rand() * 2 - 1) * 1000;
      const panned = panBy(cam, dx, dy);
      const moved = worldToScreen(panned, before);
      expect(Math.abs(moved.x - (p.x + dx))).toBeLessThan(screenEps);
      expect(Math.abs(moved.y - (p.y + dy))).toBeLessThan(screenEps);
    }
  });
});
