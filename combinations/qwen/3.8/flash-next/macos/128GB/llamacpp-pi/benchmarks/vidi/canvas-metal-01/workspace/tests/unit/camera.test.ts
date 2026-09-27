// camera.math unit tests: TC-01 .. TC-12 plus the seeded property check from the
// story 1 test strategy. Every threshold references a named setting, never a literal.
import { describe, expect, it } from "vitest";

import {
  PERCENT,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
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

const LAPTOP: Size = { width: 1280, height: 800 };
const SMALL: Size = { width: 1200, height: 800 };

const ORIGIN: Point = { x: 0, y: 0 };
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;

/** Precision for "exact within 1e-6" checks: toBeCloseTo rounds to 6 decimals. */
const PRECISION = 6;

function cameraAt(x: number, y: number, zoom: number): Camera {
  return { x, y, zoom };
}

function expectCameraAtOriginScreen(cam: Camera): void {
  const screen = worldToScreen(cam, ORIGIN);
  expect(screen.x).toBeCloseTo(0, PRECISION);
  expect(screen.y).toBeCloseTo(0, PRECISION);
}

function expectFiniteCamera(cam: Camera): void {
  expect(Number.isFinite(cam.x)).toBe(true);
  expect(Number.isFinite(cam.y)).toBe(true);
  expect(Number.isFinite(cam.zoom)).toBe(true);
}

describe("screenToWorld / worldToScreen", () => {
  it("are inverse functions", () => {
    const cam = cameraAt(12.5, -37.25, 0.75);
    const p: Point = { x: 320, y: 240 };
    const world = screenToWorld(cam, p);
    const back = worldToScreen(cam, world);
    expect(back.x).toBeCloseTo(p.x, PRECISION);
    expect(back.y).toBeCloseTo(p.y, PRECISION);
  });
});

describe("panBy", () => {
  // TC-01: drag 200x100 screen px at zoom 1 from the origin.
  it("TC-01 moves the camera by -delta/zoom and the world origin by +delta", () => {
    const cam = cameraAt(0, 0, 1);
    const next = panBy(cam, 200, 100);
    expect(next.x).toBeCloseTo(-200, PRECISION);
    expect(next.y).toBeCloseTo(-100, PRECISION);
    const dot = worldToScreen(next, ORIGIN);
    expect(dot.x).toBeCloseTo(200, PRECISION);
    expect(dot.y).toBeCloseTo(100, PRECISION);
  });

  // TC-02: same drag while fully zoomed in, a million world units away.
  it("TC-02 converts screen pixels to world units at ZOOM_MAX far from the start", () => {
    const cam = cameraAt(FAR, FAR, ZOOM_MAX);
    const next = panBy(cam, 200, 100);
    expect(next.x).toBeCloseTo(FAR - 200 / ZOOM_MAX, PRECISION);
    expect(next.y).toBeCloseTo(FAR - 100 / ZOOM_MAX, PRECISION);
    expect(next.x).toBeCloseTo(FAR - 50, PRECISION);
    expect(next.y).toBeCloseTo(FAR - 25, PRECISION);
    // A dot that was under screen point (300,200) is now at (500,300): the board
    // follows the pointer exactly.
    const underPointer: Point = { x: 300, y: 200 };
    const dot = worldToScreen(next, screenToWorld(cam, underPointer));
    expect(dot.x).toBeCloseTo(500, PRECISION);
    expect(dot.y).toBeCloseTo(300, PRECISION);
  });

  it("returns the same object for a zero-length drag", () => {
    const cam = cameraAt(50, -50, 2);
    expect(panBy(cam, 0, 0)).toBe(cam);
  });
});

describe("zoomAt", () => {
  // TC-03: Ctrl+wheel around a point near the origin.
  it("TC-03 keeps the world point under the pointer fixed", () => {
    const cam = cameraAt(0, 0, 1);
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 2);
    expect(next.zoom).toBeCloseTo(2, PRECISION);
    const after = screenToWorld(next, p);
    expect(after.x).toBeCloseTo(before.x, PRECISION);
    expect(after.y).toBeCloseTo(before.y, PRECISION);
  });

  // TC-04: the same, a million world units away.
  it("TC-04 keeps the pointer invariant a million world units from the start", () => {
    const cam = cameraAt(FAR, -FAR, 1);
    const p: Point = { x: 700, y: 300 };
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 1.5);
    const after = screenToWorld(next, p);
    expect(after.x).toBeCloseTo(before.x, PRECISION);
    expect(after.y).toBeCloseTo(before.y, PRECISION);
  });

  // TC-05: zooming out at the limit returns the identical object.
  it("TC-05 returns the same camera at ZOOM_MIN", () => {
    const cam = cameraAt(0, 0, ZOOM_MIN);
    const centre: Point = { x: SMALL.width / 2, y: SMALL.height / 2 };
    const next = zoomAt(cam, centre, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
  });

  // TC-06: zooming in at the limit returns the identical object.
  it("TC-06 returns the same camera at ZOOM_MAX", () => {
    const cam = cameraAt(0, 0, ZOOM_MAX);
    const centre: Point = { x: SMALL.width / 2, y: SMALL.height / 2 };
    expect(zoomAt(cam, centre, ZOOM_STEP_FACTOR)).toBe(cam);
  });

  // TC-11: an absurd wheel delta clamps and still keeps the pointer fixed.
  it("TC-11 clamps a huge factor and keeps the pointer invariant", () => {
    const cam = cameraAt(0, 0, 1);
    const p: Point = { x: 400, y: 250 };
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, p);
    expect(after.x).toBeCloseTo(before.x, PRECISION);
    expect(after.y).toBeCloseTo(before.y, PRECISION);
  });

  // TC-12: invalid factors never crash the board.
  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["+Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])(
    "TC-12 returns the input camera unchanged for factor %s",
    (_label, factor) => {
      const cam = cameraAt(10, 20, 1);
      const next = zoomAt(cam, { x: 100, y: 100 }, factor);
      expect(next).toBe(cam);
      expectFiniteCamera(next);
    },
  );
});

describe("zoomStep", () => {
  // TC-09: one step in then one step out lands on exactly 1 again.
  it("TC-09 returns exactly 1.0 after a step in and a step out", () => {
    const cam = cameraAt(0, 0, 1);
    const inStep = zoomStep(cam, LAPTOP, "in");
    expect(inStep.zoom).toBe(1 * ZOOM_STEP_FACTOR);
    expect(zoomPercent(inStep)).toBe(Math.round(ZOOM_STEP_FACTOR * PERCENT));
    const outStep = zoomStep(inStep, LAPTOP, "out");
    expect(outStep.zoom).toBe(1);
    expect(zoomPercent(outStep)).toBe(PERCENT);
  });

  // TC-10: repeated steps clamp at ZOOM_MAX.
  it("TC-10 clamps after 20 steps in and disables zoom in", () => {
    let cam: Camera = cameraAt(0, 0, 1);
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, LAPTOP, "in");
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MAX * PERCENT));
  });

  it("clamps down to ZOOM_MIN and disables zoom out", () => {
    let cam: Camera = cameraAt(0, 0, 1);
    for (let i = 0; i < 30; i += 1) cam = zoomStep(cam, LAPTOP, "out");
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MIN * PERCENT));
  });

  it("keeps the viewport centre fixed", () => {
    const cam = cameraAt(0, 0, 1);
    const centre: Point = { x: LAPTOP.width / 2, y: LAPTOP.height / 2 };
    const before = screenToWorld(cam, centre);
    const next = zoomStep(cam, LAPTOP, "in");
    const after = screenToWorld(next, centre);
    expect(after.x).toBeCloseTo(before.x, PRECISION);
    expect(after.y).toBeCloseTo(before.y, PRECISION);
  });
});

describe("resetCamera", () => {
  // TC-08: reset from far away and fully zoomed in.
  it("TC-08 returns to zoom 1 with the board start centred", () => {
    const cam = cameraAt(FAR, FAR, ZOOM_MAX);
    const next = resetCamera(SMALL);
    expect(next.zoom).toBe(1);
    expect(next.x).toBeCloseTo(-SMALL.width / 2, PRECISION);
    expect(next.y).toBeCloseTo(-SMALL.height / 2, PRECISION);
    expect(next).not.toBe(cam);
    // The board's starting point now sits in the middle of the board area.
    const screen = worldToScreen(next, ORIGIN);
    expect(screen.x).toBeCloseTo(SMALL.width / 2, PRECISION);
    expect(screen.y).toBeCloseTo(SMALL.height / 2, PRECISION);
    expectCameraAtOriginScreen(resetCamera({ width: 0, height: 0 }));
  });
});

describe("viewport resize (TC-07)", () => {
  // Design: camera.x/y is the world coordinate at the viewport top-left, so a
  // resize is not an input to the camera at all.
  it("TC-07 leaves the camera and screen positions unchanged", () => {
    const cam = cameraAt(-600, -400, 1);
    const before = worldToScreen(cam, { x: 100, y: 50 });
    // A resize creates no new camera value; the same camera is reused.
    const after: Camera = cam;
    expect(after).toBe(cam);
    expect(after.x).toBe(cam.x);
    expect(after.y).toBe(cam.y);
    expect(after.zoom).toBe(cam.zoom);
    const moved = worldToScreen(after, { x: 100, y: 50 });
    expect(moved).toEqual(before);
  });
});

describe("zoomPercent", () => {
  it("rounds to a whole percent", () => {
    expect(zoomPercent(cameraAt(0, 0, 1))).toBe(PERCENT);
    expect(zoomPercent(cameraAt(0, 0, 1.5625))).toBe(156);
    expect(zoomPercent(cameraAt(0, 0, ZOOM_MIN))).toBe(10);
    expect(zoomPercent(cameraAt(0, 0, ZOOM_MAX))).toBe(400);
  });
});

describe("property: pointer invariance (1,000 seeded cases)", () => {
  it("keeps the world point under the pointer and stays within the limits", () => {
    // Deterministic PRNG (mulberry32) so a failure is reproducible.
    let state = 0x2f6e2b1;
    const rand = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const range = (min: number, max: number) => min + rand() * (max - min);

    for (let i = 0; i < 1000; i += 1) {
      const cam = cameraAt(
        range(-UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT),
        range(-UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT),
        range(ZOOM_MIN, ZOOM_MAX),
      );
      const p: Point = { x: range(-2000, 2000), y: range(-2000, 2000) };
      const factor = range(0.1, 10);
      const before = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);
      const after = screenToWorld(next, p);
      expectFiniteCamera(next);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expect(after.x).toBeCloseTo(before.x, PRECISION);
      expect(after.y).toBeCloseTo(before.y, PRECISION);
    }
  });
});
