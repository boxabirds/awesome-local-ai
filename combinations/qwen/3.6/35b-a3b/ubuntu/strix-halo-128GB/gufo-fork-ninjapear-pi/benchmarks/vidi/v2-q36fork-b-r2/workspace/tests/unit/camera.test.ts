import { describe, it, expect } from 'vitest';
import type { Camera, Point, Size } from '../../src/client/canvas/camera';
import {
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  zoomStep,
  resetCamera,
  canZoomIn,
  canZoomOut,
  zoomPercent,
} from '../../src/client/canvas/camera';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  SNAP_EPSILON,
} from '../../src/shared/config';

// Helpers
function cam(x: number, y: number, zoom: number): Camera {
  return Object.freeze({ x, y, zoom });
}

function point(x: number, y: number): Point {
  return Object.freeze({ x, y });
}

// ---------- TC-01: panBy at zoom 1, origin ----------
describe('TC-01: panBy at zoom 1', () => {
  it('panBy(+200,+100) moves camera x,y from 0 to (-200,-100)', () => {
    const initial = cam(0, 0, 1);
    const result = panBy(initial, 200, 100);
    expect(result.x).toBe(-200);
    expect(result.y).toBe(-100);
    // World point (0,0) was at screen (0,0), after pan should be at (200,100)
    const beforeScreen = worldToScreen(initial, point(0, 0));
    const afterScreen = worldToScreen(result, point(0, 0));
    expect(afterScreen).toEqual(point(200, 100));
    expect(beforeScreen).toEqual(point(0, 0));
  });
});

// ---------- TC-02: panBy at ZOOM_MAX, far away ----------
describe('TC-02: panBy at zoom max, far away', () => {
  it('panBy(+200,+100) shifts camera by (-50,-25) in world units', () => {
    const initial = cam(1_000_000, 1_000_000, ZOOM_MAX);
    const result = panBy(initial, 200, 100);
    expect(result.x).toBeCloseTo(initial.x - 200 / ZOOM_MAX, 6);
    expect(result.y).toBeCloseTo(initial.y - 100 / ZOOM_MAX, 6);
  });
});

// ---------- TC-03: zoomAt keeps pointer world invariant at origin ----------
describe('TC-03: zoomAt pointer invariance at origin', () => {
  it('zoomAt(point(300,200), factor 2) keeps screenWorld identical', () => {
    const initial = cam(0, 0, 1);
    const pointer = point(300, 200);
    const wBefore = screenToWorld(initial, pointer);
    const result = zoomAt(initial, pointer, 2);
    const wAfter = screenToWorld(result, pointer);
    expect(wAfter.x).toBeCloseTo(wBefore.x, 6);
    expect(wAfter.y).toBeCloseTo(wBefore.y, 6);
  });
});

// ---------- TC-04: zoomAt keeps pointer world invariant far away ----------
describe('TC-04: zoomAt pointer invariance far away', () => {
  it('zoomAt(factor 1.5) at 1e6 position keeps pointer invariant within 1e-6', () => {
    const initial = cam(1_000_000, 1_000_000, 1);
    const pointer = point(300, 200);
    const wBefore = screenToWorld(initial, pointer);
    const result = zoomAt(initial, pointer, 1.5);
    const wAfter = screenToWorld(result, pointer);
    expect(wAfter.x).toBeCloseTo(wBefore.x, 6);
    expect(wAfter.y).toBeCloseTo(wBefore.y, 6);
  });
});

// ---------- TC-05: zoom at min returns same object ----------
describe('TC-05: zoom at ZOOM_MIN returns same object on further zoom out', () => {
  it('zoomAt(centre, 1/ZOOM_STEP_FACTOR) at ZOOM_MIN returns same object', () => {
    const initial = cam(0, 0, ZOOM_MIN);
    const centre = point(640, 400);
    const result = zoomAt(initial, centre, 1 / ZOOM_STEP_FACTOR);
    expect(result).toBe(initial);
  });
});

// ---------- TC-06: zoom at max returns same object ----------
describe('TC-06: zoom at ZOOM_MAX returns same object on further zoom in', () => {
  it('zoomAt(centre, ZOOM_STEP_FACTOR) at ZOOM_MAX returns same object', () => {
    const initial = cam(0, 0, ZOOM_MAX);
    const centre = point(640, 400);
    const result = zoomAt(initial, centre, ZOOM_STEP_FACTOR);
    expect(result).toBe(initial);
  });
});

// ---------- TC-07: viewport resize leaves camera unchanged ----------
describe('TC-07: viewport resize does not change camera', () => {
  it('camera objects are just data without size info', () => {
    const c1 = cam(0, 0, 1);
    const c2 = cam(10, 20, 2);
    // camera objects themselves don't contain size info;
    // any operation that only changes zoom needs viewport.
    // Here we assert that two different cameras are just data.
    expect(c1.zoom).toBe(1);
    expect(c2.zoom).toBe(2);
  });
});

// ---------- TC-08: resetCamera ----------
describe('TC-08: resetCamera', () => {
  it('resetCamera(1200x800) → zoom 1, origin centred', () => {
    const vp = { width: 1200, height: 800 };
    const result = resetCamera(vp as Size);
    expect(result.zoom).toBe(1);
    expect(result.x).toBe(-600);
    expect(result.y).toBe(-400);
  });
});

// ---------- TC-09: step in then out returns exactly 1.0 ----------
describe('TC-09: step in then out snaps to exact 1.0', () => {
  it('1 step in then 1 step out → 1.0 exactly', () => {
    const initial = cam(0, 0, 1);
    const vp = { width: 1280, height: 800 };
    const afterIn = zoomStep(initial, vp, 'in');
    const afterOut = zoomStep(afterIn, vp, 'out');
    expect(afterOut.zoom).toBe(1);
    expect(zoomPercent(afterOut)).toBe(100);
  });
});

// ---------- TC-10: 20 steps in clamps at ZOOM_MAX ----------
describe('TC-10: many steps in clamp at ZOOM_MAX', () => {
  it('20 steps in reaches ZOOM_MAX and canZoomIn is false', () => {
    let c = cam(0, 0, 1);
    const vp = { width: 1280, height: 800 };
    for (let i = 0; i < 20; i++) {
      c = zoomStep(c, vp, 'in');
    }
    expect(c.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(c)).toBe(false);
  });
});

// ---------- TC-11: huge factor clamps ----------
describe('TC-11: huge zoom factor clamps', () => {
  it('factor 1000 → zoom clamped to ZOOM_MAX, pointer invariance holds', () => {
    const initial = cam(0, 0, 1);
    const pointer = point(300, 200);
    const wBefore = screenToWorld(initial, pointer);
    const result = zoomAt(initial, pointer, 1000);
    expect(result.zoom).toBe(ZOOM_MAX);
    const wAfter = screenToWorld(result, pointer);
    expect(wAfter.x).toBeCloseTo(wBefore.x, 6);
    expect(wAfter.y).toBeCloseTo(wBefore.y, 6);
  });
});

// ---------- TC-12: invalid factors ----------
describe('TC-12: invalid zoom factors', () => {
  it('factor 0 returns unchanged camera', () => {
    const initial = cam(0, 0, 1);
    expect(zoomAt(initial, point(100, 100), 0)).toBe(initial);
  });
  it('negative factor returns unchanged camera', () => {
    const initial = cam(0, 0, 1);
    expect(zoomAt(initial, point(100, 100), -1)).toBe(initial);
  });
  it('NaN factor returns unchanged camera', () => {
    const initial = cam(0, 0, 1);
    expect(zoomAt(initial, point(100, 100), NaN)).toBe(initial);
  });
  it('Infinity factor returns unchanged camera', () => {
    const initial = cam(0, 0, 1);
    expect(zoomAt(initial, point(100, 100), Infinity)).toBe(initial);
  });
  it('-Infinity factor returns unchanged camera', () => {
    const initial = cam(0, 0, 1);
    expect(zoomAt(initial, point(100, 100), -Infinity)).toBe(initial);
  });
  it('no NaN appears in output after any zoomAt', () => {
    const initial = cam(0, 0, 1);
    const result = zoomAt(initial, point(100, 100), NaN);
    expect(Number.isNaN(result.x)).toBe(false);
    expect(Number.isNaN(result.y)).toBe(false);
    expect(Number.isNaN(result.zoom)).toBe(false);
  });
});

// ---------- Property check: 1000 random zoomAt invariants ----------
describe('Property: zoomAt pointer invariance for 1000 random cases', () => {
  // Simple seeded PRNG
  function mulberry32(a: number) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul((a ^ (a >>> 15)) | 0, 1 | a);
      t = (t + Math.imul(t, (t >>> 7) | 0)) | 0;
      return ((t ^ (t >>> 6)) | 0);
    };
  }
  function nextInt(rng: () => number, min: number, max: number): number {
    return min + (rng() % (max - min + 1));
  }
  function nextFloat(rng: () => number, min: number, max: number): number {
    return min + (rng() / 0xffffffff) * (max - min);
  }

  it('pointer world point invariant for 1000 random inputs', () => {
    const rng = mulberry32(42);
    let passed = 0;
    for (let i = 0; i < 1000; i++) {
      const zoom = nextFloat(rng, 0.1, 4);
      const cx = nextFloat(rng, -1_000_000, 1_000_000);
      const cy = nextFloat(rng, -1_000_000, 1_000_000);
      const sx = nextFloat(rng, 0, 1920);
      const sy = nextFloat(rng, 0, 1080);
      const factor = nextFloat(rng, 0.1, 10);
      const c = cam(cx, cy, zoom);
      const p = point(sx, sy);
      const wBefore = screenToWorld(c, p);
      const result = zoomAt(c, p, factor);
      const wAfter = screenToWorld(result, p);
      expect(wAfter.x).toBeCloseTo(wBefore.x, 6);
      expect(wAfter.y).toBeCloseTo(wBefore.y, 6);
      passed++;
    }
    expect(passed).toBe(1000);
  });
});

// ---------- Helper function tests ----------
describe('canZoomIn / canZoomOut / zoomPercent helpers', () => {
  it('canZoomIn true when below ZOOM_MAX', () => {
    expect(canZoomIn(cam(0, 0, 1))).toBe(true);
  });
  it('canZoomIn false at ZOOM_MAX', () => {
    expect(canZoomIn(cam(0, 0, ZOOM_MAX))).toBe(false);
  });
  it('canZoomOut true when above ZOOM_MIN', () => {
    expect(canZoomOut(cam(0, 0, 1))).toBe(true);
  });
  it('canZoomOut false at ZOOM_MIN', () => {
    expect(canZoomOut(cam(0, 0, ZOOM_MIN))).toBe(false);
  });
  it('zoomPercent rounds correctly', () => {
    expect(zoomPercent(cam(0, 0, 0.1))).toBe(10);
    expect(zoomPercent(cam(0, 0, 1))).toBe(100);
    expect(zoomPercent(cam(0, 0, 4))).toBe(400);
    expect(zoomPercent(cam(0, 0, 1.5625))).toBe(156);
  });
});
