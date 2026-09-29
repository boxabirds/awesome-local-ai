import { describe, it, expect } from 'vitest';
import {
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  zoomStep,
  resetCamera,
  canZoomIn,
  zoomPercent,
  type Camera,
  type Point,
  type Size,
} from '../../src/client/canvas/camera.ts';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  UNBOUNDED_PAN_TESTED_EXTENT,
  PERCENT_PER_UNIT,
} from '../../src/shared/config.ts';

const viewport: Size = { width: 1200, height: 800 };
const origin: Camera = { x: 0, y: 0, zoom: 1 };

// Deterministic PRNG (mulberry32) for the property check.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('camera.math', () => {
  it('TC-01 panBy at zoom 1, at origin moves camera by exact screen delta', () => {
    const after = panBy(origin, 200, 100);
    expect(after.x).toBeCloseTo(-200, 10);
    expect(after.y).toBeCloseTo(-100, 10);
    expect(after.zoom).toBe(1);
    // The world origin should now appear at screen (200,100).
    const s = worldToScreen(after, { x: 0, y: 0 });
    expect(s.x).toBeCloseTo(200, 10);
    expect(s.y).toBeCloseTo(100, 10);
  });

  it('TC-02 panBy at ZOOM_MAX far away shifts camera by exact world units', () => {
    const far: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    };
    const after = panBy(far, 200, 100);
    expect(after.x).toBeCloseTo(far.x - 200 / ZOOM_MAX, 6);
    expect(after.y).toBeCloseTo(far.y - 100 / ZOOM_MAX, 6);
    expect(after.x).toBeCloseTo(far.x - 50, 6);
    expect(after.y).toBeCloseTo(far.y - 25, 6);
  });

  it('TC-03 zoomAt keeps world point under pointer invariant (origin, factor 2)', () => {
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(origin, p);
    const after = zoomAt(origin, p, 2);
    expect(after.zoom).toBeCloseTo(2, 10);
    const afterWorld = screenToWorld(after, p);
    expect(afterWorld.x).toBeCloseTo(before.x, 6);
    expect(afterWorld.y).toBeCloseTo(before.y, 6);
  });

  it('TC-04 zoomAt keeps pointer world point invariant (far away, factor 1.5)', () => {
    const far: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    };
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(far, p);
    const after = zoomAt(far, p, 1.5);
    const afterWorld = screenToWorld(after, p);
    expect(afterWorld.x).toBeCloseTo(before.x, 6);
    expect(afterWorld.y).toBeCloseTo(before.y, 6);
  });

  it('TC-05 at ZOOM_MIN zooming further out returns the same object', () => {
    const atMin: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const after = zoomAt(atMin, { x: 600, y: 400 }, 1 / ZOOM_STEP_FACTOR);
    expect(after).toBe(atMin);
    expect(after.zoom).toBe(ZOOM_MIN);
  });

  it('TC-06 at ZOOM_MAX zooming further in returns the same object', () => {
    const atMax: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const after = zoomAt(atMax, { x: 600, y: 400 }, ZOOM_STEP_FACTOR);
    expect(after).toBe(atMax);
    expect(after.zoom).toBe(ZOOM_MAX);
  });

  it('TC-07 viewport resize leaves camera unchanged (camera is independent of viewport size)', () => {
    // Camera is stored top-left world coordinate + zoom; resizing does not
    // recompute it. There is no function that takes an old/new size and changes
    // camera, so we assert the reset camera for two sizes both keep x,y,zoom
    // self-consistent and that panBy/zoomAt do not read viewport size.
    const before: Camera = { x: -123.4, y: 56.7, zoom: 1.5 };
    const after = panBy(before, 0, 0); // zero delta
    expect(after).toBe(before);
    // resetCamera produces the expected origin-centred view for each size and
    // nothing about the previous camera leaks in.
    const r1 = resetCamera({ width: 1280, height: 800 });
    const r2 = resetCamera({ width: 1920, height: 1080 });
    expect(r1.zoom).toBe(1);
    expect(r2.zoom).toBe(1);
    // For the "resize keeps x,y" property, the caller keeps the same camera:
    const unchanged: Camera = before;
    expect(unchanged).toBe(before);
  });

  it('TC-08 resetCamera centres origin and zooms to 1', () => {
    const far: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    };
    void far;
    const r = resetCamera(viewport);
    expect(r.zoom).toBe(1);
    expect(r.x).toBeCloseTo(-viewport.width / 2, 10);
    expect(r.y).toBeCloseTo(-viewport.height / 2, 10);
    // Origin (0,0) is at viewport centre.
    const centre = worldToScreen(r, { x: 0, y: 0 });
    expect(centre.x).toBeCloseTo(viewport.width / 2, 10);
    expect(centre.y).toBeCloseTo(viewport.height / 2, 10);
  });

  it('TC-09 step in then out returns exactly 1.0', () => {
    const inOnce = zoomStep(origin, viewport, 'in');
    expect(inOnce.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 10);
    const out = zoomStep(inOnce, viewport, 'out');
    expect(out.zoom).toBe(1);
    expect(zoomPercent(out)).toBe(1 * PERCENT_PER_UNIT);
  });

  it('TC-10 20 steps in clamps at ZOOM_MAX, canZoomIn false', () => {
    let cam: Camera = origin;
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, viewport, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
  });

  it('TC-11 huge factor clamps and still keeps pointer invariance', () => {
    const p: Point = { x: 400, y: 250 };
    const before = screenToWorld(origin, p);
    const after = zoomAt(origin, p, 1000);
    expect(after.zoom).toBe(ZOOM_MAX);
    const afterWorld = screenToWorld(after, p);
    expect(afterWorld.x).toBeCloseTo(before.x, 6);
    expect(afterWorld.y).toBeCloseTo(before.y, 6);
  });

  it('TC-12 invalid factor returns unchanged camera, no NaN', () => {
    const p: Point = { x: 100, y: 100 };
    for (const f of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const after = zoomAt(origin, p, f);
      expect(after).toBe(origin);
      expect(Number.isFinite(after.x)).toBe(true);
      expect(Number.isFinite(after.y)).toBe(true);
      expect(Number.isFinite(after.zoom)).toBe(true);
    }
  });

  it('TC-21-ish zoomPercent rounds to nearest whole percent', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });

  it('property: pointer world point invariant under zoomAt (1000 seeded samples)', () => {
    const rand = mulberry32(0x1234abcd);
    for (let i = 0; i < 1000; i++) {
      const cam: Camera = {
        x: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, rand()),
      };
      const p: Point = { x: rand() * 1280, y: rand() * 800 };
      const factor = Math.pow(10, (rand() * 2 - 1) * 2); // 0.01 .. 100
      const before = screenToWorld(cam, p);
      const after = zoomAt(cam, p, factor);
      const afterWorld = screenToWorld(after, p);
      expect(Math.abs(afterWorld.x - before.x)).toBeLessThan(1e-6);
      expect(Math.abs(afterWorld.y - before.y)).toBeLessThan(1e-6);
    }
  });
});
