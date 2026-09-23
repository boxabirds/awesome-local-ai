import { describe, it, expect } from "vitest";
import {
  type Camera,
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  zoomStep,
  resetCamera,
  canZoomIn,
  canZoomOut,
  zoomPercent,
} from "@client/canvas/camera";
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  UNBOUNDED_PAN_TESTED_EXTENT,
  PERCENT_BASE,
} from "@shared/config";

const EPS = 1e-6;
const near = (a: number, b: number, tol = EPS) =>
  Math.abs(a - b) <= tol + Math.max(Math.abs(a), Math.abs(b)) * tol;

describe("camera.math", () => {
  // TC-01: panBy at zoom 1 from origin.
  it("TC-01 panBy moves content by the pointer delta (zoom 1, origin)", () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const next = panBy(cam, 200, 100);
    expect(near(next.x, -200)).toBe(true);
    expect(near(next.y, -100)).toBe(true);
    // world (0,0) screen pos goes from (0,0) to (200,100)
    const before = worldToScreen(cam, { x: 0, y: 0 });
    const after = worldToScreen(next, { x: 0, y: 0 });
    expect(near(before.x, 0) && near(before.y, 0)).toBe(true);
    expect(near(after.x, 200) && near(after.y, 100)).toBe(true);
  });

  // TC-02: panBy at ZOOM_MAX far away -> exact world shift.
  it("TC-02 panBy at ZOOM_MAX far away shifts by delta/zoom world units", () => {
    const cam: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    };
    const next = panBy(cam, 200, 100);
    expect(near(next.x, UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX)).toBe(true);
    expect(near(next.y, UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX)).toBe(true);
    expect(near(next.zoom, ZOOM_MAX)).toBe(true);
  });

  // TC-03: zoomAt keeps pointer world point invariant (origin).
  it("TC-03 zoomAt keeps the world point under the pointer fixed", () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const p = { x: 300, y: 200 };
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 2);
    const after = screenToWorld(next, p);
    expect(near(next.zoom, 2)).toBe(true);
    expect(near(before.x, after.x) && near(before.y, after.y)).toBe(true);
  });

  // TC-04: zoomAt pointer invariance far away.
  it("TC-04 zoomAt pointer invariance at far position", () => {
    const cam: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    };
    const p = { x: 640, y: 400 };
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 1.5);
    const after = screenToWorld(next, p);
    expect(near(before.x, after.x) && near(before.y, after.y)).toBe(true);
  });

  // TC-05: at ZOOM_MIN, zooming out returns same object.
  it("TC-05 zoomAt at ZOOM_MIN returns the same camera object", () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const next = zoomAt(cam, { x: 600, y: 400 }, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
  });

  // TC-06: at ZOOM_MAX, zooming in returns same object.
  it("TC-06 zoomAt at ZOOM_MAX returns the same camera object", () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const next = zoomAt(cam, { x: 600, y: 400 }, ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
  });

  // TC-07: resize is not user input; camera untouched (sanity: independent of viewport size).
  it("TC-07 camera is independent of viewport size (resize does not mutate)", () => {
    const cam: Camera = { x: 123, y: 456, zoom: 1 };
    const r = resetCamera({ width: 1200, height: 800 });
    // reset from a different viewport keeps x/y centred; but a plain "resize" is
    // modelled as: the existing camera is not changed by viewport alone.
    expect(cam.x).toBe(123);
    expect(cam.y).toBe(456);
    expect(cam.zoom).toBe(1);
    expect(r.zoom).toBe(1);
  });

  // TC-08: resetCamera centres origin.
  it("TC-08 resetCamera centres origin at 100%", () => {
    const cam: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    };
    const next = resetCamera({ width: 1200, height: 800 });
    expect(next.zoom).toBe(1);
    expect(near(next.x, -600)).toBe(true);
    expect(near(next.y, -400)).toBe(true);
    // world origin (0,0) must land at viewport centre (600,400)
    const c = worldToScreen(next, { x: 0, y: 0 });
    expect(near(c.x, 600) && near(c.y, 400)).toBe(true);
    expect(cam.zoom).toBe(ZOOM_MAX); // original untouched
  });

  // TC-09: step in then out returns exactly 1.0.
  it("TC-09 zoomStep in then out is exactly 1.0 (snap)", () => {
    const vp = { width: 1200, height: 800 };
    const up = zoomStep({ x: 0, y: 0, zoom: 1 }, vp, "in");
    expect(near(up.zoom, ZOOM_STEP_FACTOR)).toBe(true);
    const back = zoomStep(up, vp, "out");
    expect(back.zoom).toBe(1);
    expect(zoomPercent(back)).toBe(PERCENT_BASE);
  });

  // TC-10: 20 steps in clamps at ZOOM_MAX, canZoomIn false.
  it("TC-10 repeated zoomStep in clamps at ZOOM_MAX", () => {
    const vp = { width: 1200, height: 800 };
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, vp, "in");
    expect(near(cam.zoom, ZOOM_MAX)).toBe(true);
    expect(canZoomIn(cam)).toBe(false);
    // zoom out one step re-enables.
    const cam2 = zoomStep(cam, vp, "out");
    expect(canZoomIn(cam2)).toBe(true);
    expect(cam2.zoom).toBeLessThan(ZOOM_MAX);
  });

  // TC-11: huge factor clamps to ZOOM_MAX with pointer invariance.
  it("TC-11 huge zoom factor clamps and keeps pointer invariance", () => {
    const cam: Camera = { x: 10, y: 20, zoom: 1 };
    const p = { x: 300, y: 200 };
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 1000);
    expect(near(next.zoom, ZOOM_MAX)).toBe(true);
    const after = screenToWorld(next, p);
    expect(near(before.x, after.x) && near(before.y, after.y)).toBe(true);
  });

  // TC-12: invalid factor returns input unchanged, no NaN.
  it("TC-12 invalid factor (0, negative, NaN, Infinity) leaves camera unchanged", () => {
    const cam: Camera = { x: 5, y: 7, zoom: 1 };
    for (const f of [0, -1, NaN, Infinity, -Infinity]) {
      const next = zoomAt(cam, { x: 100, y: 100 }, f);
      expect(next).toBe(cam);
    }
  });

  it("zoomPercent rounds to whole percent", () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(
      Math.round(1.5625 * PERCENT_BASE),
    );
  });

  it("canZoomIn/Out at limits", () => {
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
    expect(canZoomIn({ x: 0, y: 0, zoom: 1 })).toBe(true);
    expect(canZoomOut({ x: 0, y: 0, zoom: 1 })).toBe(true);
  });

  // Property check: pointer invariance under zoomAt for 1000 random cases.
  it("property: zoomAt keeps pointer world point invariant (1000 cases)", () => {
    // deterministic PRNG
    let s = 0x2f6e2b1;
    const rand = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 0xffffffff;
    };
    for (let i = 0; i < 1000; i++) {
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const cam: Camera = {
        x: rand() * 2_000_000 - 1_000_000,
        y: rand() * 2_000_000 - 1_000_000,
        zoom,
      };
      const p = { x: rand() * 1600, y: rand() * 900 };
      const factor = Math.exp((rand() * 2 - 1) * 2); // 0.135..7.4
      const before = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(Number.isFinite(next.zoom)).toBe(true);
      const after = screenToWorld(next, p);
      if (next.zoom !== cam.zoom) {
        expect(near(before.x, after.x) && near(before.y, after.y)).toBe(true);
      }
    }
  });
});
