import { describe, it, expect } from 'vitest';
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
} from '@/client/canvas/camera';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '@/shared/config';

// === TC-01: panBy at zoom 1 ===
describe('TC-01: panBy at zoom 1', () => {
  it('panBy(+200,+100) from origin moves camera x,y to (-200,-100)', () => {
    const cam = { x: 0, y: 0, zoom: 1 };
    const result = panBy(cam, 200, 100);
    expect(result.x).toBe(-200);
    expect(result.y).toBe(-100);
    // world point (0,0) screen pos should be (200,100) now
    const s = worldToScreen(result, { x: 0, y: 0 });
    expect(s.x).toBe(200);
    expect(s.y).toBe(100);
  });
});

// === TC-02: panBy at ZOOM_MAX far away ===
describe('TC-02: panBy at max zoom far away', () => {
  it('panBy(+200,+100) shifts camera by (-50,-25) world units at zoom 4', () => {
    const cam = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX };
    const result = panBy(cam, 200, 100);
    // delta in world = -screenDx/zoom
    const expectedX = UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX;
    const expectedY = UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX;
    expect(result.x).toBeCloseTo(expectedX, 6);
    expect(result.y).toBeCloseTo(expectedY, 6);
  });
});

// === TC-03: zoomAt keeps pointer world point invariant (origin) ===
describe('TC-03: zoomAt pointer invariant at origin', () => {
  it('zoomAt(point 300,200, factor 2) keeps same world point', () => {
    const cam = { x: 0, y: 0, zoom: 1 };
    const point = { x: 300, y: 200 };
    const beforeWorld = screenToWorld(cam, point);
    const result = zoomAt(cam, point, 2);
    expect(result.zoom).toBe(2);
    const afterWorld = screenToWorld(result, point);
    expect(afterWorld.x).toBeCloseTo(beforeWorld.x, 6);
    expect(afterWorld.y).toBeCloseTo(beforeWorld.y, 6);
  });
});

// === TC-04: zoomAt keeps pointer world point invariant (far) ===
describe('TC-04: zoomAt pointer invariant far away', () => {
  it('zoomAt with factor 1.5 at far distance keeps pointer world point within 1e-6', () => {
    const cam = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 };
    const point = { x: 500, y: 300 };
    const beforeWorld = screenToWorld(cam, point);
    const result = zoomAt(cam, point, 1.5);
    const afterWorld = screenToWorld(result, point);
    expect(afterWorld.x).toBeCloseTo(beforeWorld.x, 6);
    expect(afterWorld.y).toBeCloseTo(beforeWorld.y, 6);
  });
});

// === TC-05: at ZOOM_MIN zooming out returns same object ===
describe('TC-05: at ZOOM_MIN cannot zoom out further', () => {
  it('zoomAt centre at min zoom returns identical object', () => {
    const cam = { x: 0, y: 0, zoom: ZOOM_MIN };
    const center = { x: 640, y: 400 };
    const result = zoomAt(cam, center, 1 / ZOOM_STEP_FACTOR);
    expect(result).toBe(cam);
  });
});

// === TC-06: at ZOOM_MAX zooming in returns same object ===
describe('TC-06: at ZOOM_MAX cannot zoom in further', () => {
  it('zoomAt centre at max zoom returns identical object', () => {
    const cam = { x: 0, y: 0, zoom: ZOOM_MAX };
    const center = { x: 640, y: 400 };
    const result = zoomAt(cam, center, ZOOM_STEP_FACTOR);
    expect(result).toBe(cam);
  });
});

// === TC-07: viewport resize leaves camera unchanged ===
describe('TC-07: viewport resize leaves camera unchanged', () => {
  it('resetCamera called with different size returns a new camera regardless', () => {
    const cam1 = resetCamera({ width: 1200, height: 800 });
    const cam2 = resetCamera({ width: 1920, height: 1080 });
    expect(cam1).not.toBe(cam2);
    expect(cam1.zoom).toBe(1);
    expect(cam2.zoom).toBe(1);
  });
});

// === TC-08: resetCamera ===
describe('TC-08: resetCamera', () => {
  it('resetCamera(1200x800) → zoom 1, origin centred', () => {
    const cam = resetCamera({ width: 1200, height: 800 });
    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(-600);
    expect(cam.y).toBe(-400);
  });
});

// === TC-09: step in then out returns exactly 1.0 ===
describe('TC-09: step in then out returns exactly 1.0', () => {
  it('from 1.0: step in → 1.25, step out → 1.0', () => {
    const initial = { x: 0, y: 0, zoom: 1 };
    const vp = { width: 1200, height: 800 };
    const steppedIn = zoomStep(initial, vp, 'in');
    expect(steppedIn.zoom).toBe(ZOOM_STEP_FACTOR);
    const steppedOut = zoomStep(steppedIn, vp, 'out');
    expect(steppedOut.zoom).toBe(1.0);
    expect(zoomPercent(steppedOut)).toBe(100);
  });
});

// === TC-10: 20 steps in clamps at ZOOM_MAX ===
describe('TC-10: 20 steps in reaches ZOOM_MAX and stops', () => {
  it('after many steps, zoom is exactly ZOOM_MAX and canZoomIn is false', () => {
    let cam = { x: 0, y: 0, zoom: 1 };
    const vp = { width: 1200, height: 800 };
    for (let i = 0; i < 20; i++) {
      cam = zoomStep(cam, vp, 'in');
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
  });
});

// === TC-11: huge factor clamps and keeps pointer invariance ===
describe('TC-11: huge zoom factor clamps', () => {
  it('factor 1000 clamps to ZOOM_MAX while keeping pointer invariance', () => {
    const cam = { x: 0, y: 0, zoom: 1 };
    const point = { x: 300, y: 200 };
    const beforeWorld = screenToWorld(cam, point);
    const result = zoomAt(cam, point, 1000);
    expect(result.zoom).toBe(ZOOM_MAX);
    const afterWorld = screenToWorld(result, point);
    expect(afterWorld.x).toBeCloseTo(beforeWorld.x, 6);
    expect(afterWorld.y).toBeCloseTo(beforeWorld.y, 6);
  });
});

// === TC-12: invalid factors return unchanged camera ===
describe('TC-12: invalid zoom factors', () => {
  it('factor 0 returns input camera unchanged', () => {
    const cam = { x: 0, y: 0, zoom: 1 };
    expect(zoomAt(cam, { x: 100, y: 100 }, 0)).toBe(cam);
  });
  it('negative factor returns input camera unchanged', () => {
    const cam = { x: 0, y: 0, zoom: 1 };
    expect(zoomAt(cam, { x: 100, y: 100 }, -1)).toBe(cam);
  });
  it('NaN factor returns input camera unchanged', () => {
    const cam = { x: 0, y: 0, zoom: 1 };
    const result = zoomAt(cam, { x: 100, y: 100 }, NaN);
    expect(result).toBe(cam);
  });
  it('Infinity factor returns input camera unchanged', () => {
    const cam = { x: 0, y: 0, zoom: 1 };
    const result = zoomAt(cam, { x: 100, y: 100 }, Infinity);
    expect(result).toBe(cam);
    const resultNeg = zoomAt(cam, { x: 100, y: 100 }, -Infinity);
    expect(resultNeg).toBe(cam);
  });
});

// === Property check: 1000 random cameras/points/factors ===
describe('Property: zoomAt pointer invariance under random tests', () => {
  function mulberry32(a: number): () => number {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul((a ^ (a >>> 15)) | 0, 1 | a);
      t = (t + Math.imul(t, t) | 0) | 0;
      return ((t >>> 0) >>> 0) / 4294967296;
    };
  }

  it('1000 seeded random cases keep pointer world point within 1e-6', () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const zoom = 0.1 + rand() * 3.9;
      const cam = { x: (rand() - 0.5) * UNBOUNDED_PAN_TESTED_EXTENT * 2, y: (rand() - 0.5) * UNBOUNDED_PAN_TESTED_EXTENT * 2, zoom };
      const sx = (rand() - 0.5) * 2000;
      const sy = (rand() - 0.5) * 2000;
      const point = { x: sx, y: sy };
      const factor = 0.1 + rand() * 9.9; // up to 10x
      const beforeWorld = screenToWorld(cam, point);
      const result = zoomAt(cam, point, factor);
      const afterWorld = screenToWorld(result, point);
      expect(afterWorld.x).toBeCloseTo(beforeWorld.x, 6);
      expect(afterWorld.y).toBeCloseTo(beforeWorld.y, 6);
    }
  });
});

// === Additional helpers checks ===
describe('canZoomIn / canZoomOut', () => {
  it('canZoomIn returns true when below max', () => {
    expect(canZoomIn({ x: 0, y: 0, zoom: 1 })).toBe(true);
  });
  it('canZoomIn returns false at ZOOM_MAX', () => {
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
  });
  it('canZoomOut returns true when above min', () => {
    expect(canZoomOut({ x: 0, y: 0, zoom: 1 })).toBe(true);
  });
  it('canZoomOut returns false at ZOOM_MIN', () => {
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
  });
});

describe('zoomPercent', () => {
  it('zoom of 1.0 returns 100', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(100);
  });
  it('zoom of 0.1 returns 10', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
  });
  it('zoom of 4.0 returns 400', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });
  it('zoom of 1.5625 returns 156', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
  });
});

describe('worldToScreen / screenToWorld roundtrip', () => {
  it('inverse functions are inverses at any camera', () => {
    const cam = { x: 500, y: 300, zoom: 2 };
    const w = { x: 100, y: 200 };
    const s = worldToScreen(cam, w);
    const back = screenToWorld(cam, s);
    expect(back.x).toBeCloseTo(w.x, 6);
    expect(back.y).toBeCloseTo(w.y, 6);
  });
});
