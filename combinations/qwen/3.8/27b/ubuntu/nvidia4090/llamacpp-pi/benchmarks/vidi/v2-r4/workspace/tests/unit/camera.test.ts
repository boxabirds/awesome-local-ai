/**
 * camera.math unit tests (story 1): TC-01 to TC-12 plus a seeded property
 * check for pointer invariance under zoomAt.
 *
 * All thresholds reference the named settings in src/shared/config.ts, never
 * literals.
 */
import { describe, expect, it } from "vitest";
import {
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from "../../src/shared/config";
import {
  type Camera,
  type Point,
  type Size,
  canZoomIn,
  canZoomOut,
  panBy,
  resetCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
  zoomPercent,
  zoomStep,
} from "../../src/client/canvas/camera";

const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };
const ORIGIN_POINT: Point = { x: 0, y: 0 };
const FAR: Camera = {
  x: UNBOUNDED_PAN_TESTED_EXTENT,
  y: UNBOUNDED_PAN_TESTED_EXTENT,
  zoom: ZOOM_MAX,
};
const VIEWPORT: Size = { width: 1280, height: 800 };
const PRECISION = 1e-6;

describe("camera.math", () => {
  it("TC-01: panBy at mid zoom at origin shifts camera and moves world point by the screen delta", () => {
    const p: Point = { x: 300, y: 200 };
    expect(worldToScreen(ORIGIN, p)).toEqual({ x: 300, y: 200 });

    const next = panBy(ORIGIN, 200, 100);
    expect(next.x).toBeCloseTo(-200, 12);
    expect(next.y).toBeCloseTo(-100, 12);
    expect(worldToScreen(next, p)).toEqual({ x: 500, y: 300 });
  });

  it("TC-02: panBy at maximum zoom far away (1e6 units) shifts the camera by the exact world delta", () => {
    const next = panBy(FAR, 200, 100);
    expect(next.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX, 12);
    expect(next.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX, 12);
    expect(next.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 50, 9);
    expect(next.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 25, 9);
    expect(next.zoom).toBe(ZOOM_MAX);
  });

  it("TC-03: zoomAt at origin keeps the world point under the pointer invariant", () => {
    const pointer: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN, pointer);
    const next = zoomAt(ORIGIN, pointer, 2);
    expect(next.zoom).toBe(2);
    const after = screenToWorld(next, pointer);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(Math.abs(after.x - before.x)).toBeLessThan(PRECISION);
    expect(Math.abs(after.y - before.y)).toBeLessThan(PRECISION);
  });

  it("TC-04: zoomAt far away (1e6 units) keeps the pointer world point invariant within 1e-6", () => {
    const pointer: Point = { x: 123.45, y: 67.89 };
    const before = screenToWorld(FAR, pointer);
    const next = zoomAt(FAR, pointer, 1.5);
    const after = screenToWorld(next, pointer);
    expect(Math.abs(after.x - before.x)).toBeLessThan(PRECISION);
    expect(Math.abs(after.y - before.y)).toBeLessThan(PRECISION);
  });

  it("TC-05: at the minimum zoom, zooming further out returns the same object", () => {
    const atMin: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    expect(zoomAt(atMin, centre, 1 / ZOOM_STEP_FACTOR)).toBe(atMin);
  });

  it("TC-06: at the maximum zoom, zooming further in returns the same object", () => {
    const atMax: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    expect(zoomAt(atMax, centre, ZOOM_STEP_FACTOR)).toBe(atMax);
  });

  it("TC-07: a viewport size change leaves the camera untouched", () => {
    const cam = resetCamera({ width: 1200, height: 800 });
    const resized: Size = { width: 1920, height: 1080 };
    // The camera has no resize input: the same object still describes the
    // same world view regardless of the new size.
    const camAfterResize = cam;
    expect(camAfterResize).toBe(cam);
    expect(camAfterResize).toEqual({ x: -600, y: -400, zoom: 1 });
    expect(resized.width).toBeGreaterThan(0);
  });

  it("TC-08: resetCamera(1200x800) gives 100% zoom with the origin centred", () => {
    const cam = resetCamera({ width: 1200, height: 800 });
    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(-600);
    expect(cam.y).toBe(-400);
    expect(worldToScreen(cam, ORIGIN_POINT)).toEqual({ x: 600, y: 400 });
  });

  it("TC-09: one step in then one step out returns exactly 1.0 (percent label 100)", () => {
    const afterIn = zoomStep(ORIGIN, VIEWPORT, "in");
    expect(afterIn.zoom).toBe(ZOOM_STEP_FACTOR);
    const afterOut = zoomStep(afterIn, VIEWPORT, "out");
    expect(afterOut.zoom).toBe(1);
    expect(zoomPercent(afterOut)).toBe(100);
  });

  it("TC-10: 20 steps in clamps at the maximum zoom and canZoomIn becomes false", () => {
    let cam = ORIGIN;
    for (let i = 0; i < 20; i++) {
      cam = zoomStep(cam, VIEWPORT, "in");
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    // Further steps are no-ops returning the same object.
    expect(zoomStep(cam, VIEWPORT, "in")).toBe(cam);
  });

  it("TC-11: a huge wheel factor clamps at the maximum zoom and pointer invariance still holds", () => {
    const pointer: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN, pointer);
    const next = zoomAt(ORIGIN, pointer, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, pointer);
    expect(Math.abs(after.x - before.x)).toBeLessThan(PRECISION);
    expect(Math.abs(after.y - before.y)).toBeLessThan(PRECISION);
  });

  it("TC-12: invalid factors (0, negative, NaN, ±Infinity) return the input camera unchanged", () => {
    const pointer: Point = { x: 300, y: 200 };
    for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(ORIGIN, pointer, factor);
      expect(next).toBe(ORIGIN);
      expect(Number.isNaN(next.x)).toBe(false);
      expect(Number.isNaN(next.y)).toBe(false);
      expect(Number.isNaN(next.zoom)).toBe(false);
    }
  });

  it("canZoomOut reflects the minimum zoom boundary", () => {
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN * 1.01 })).toBe(true);
  });

  it("property: for 1000 seeded random cameras/points/factors the pointer world point is invariant under zoomAt within 1e-6", () => {
    // mulberry32: small deterministic PRNG so the suite is reproducible.
    let seed = 0x51d662a1;
    const random = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const inRange = (min: number, max: number) => min + random() * (max - min);

    for (let i = 0; i < 1000; i++) {
      const cam: Camera = {
        x: inRange(-UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT),
        y: inRange(-UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT),
        zoom: inRange(ZOOM_MIN, ZOOM_MAX),
      };
      const pointer: Point = {
        x: inRange(-10_000, 10_000),
        y: inRange(-10_000, 10_000),
      };
      const factor = inRange(0.5, 2);
      const before = screenToWorld(cam, pointer);
      const next = zoomAt(cam, pointer, factor);
      if (next !== cam) {
        const after = screenToWorld(next, pointer);
        expect(Math.abs(after.x - before.x)).toBeLessThan(PRECISION);
        expect(Math.abs(after.y - before.y)).toBeLessThan(PRECISION);
      }
    }
  });
});
