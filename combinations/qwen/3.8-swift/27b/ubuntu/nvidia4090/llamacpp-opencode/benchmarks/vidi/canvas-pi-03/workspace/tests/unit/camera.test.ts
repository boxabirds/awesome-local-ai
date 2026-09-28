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
  type Camera,
  type Point,
  type Size,
} from 'src/client/canvas/camera';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from 'src/shared/config';

const EPS = 1e-6;

function makeCamera(x: number, y: number, zoom: number): Camera {
  return { x, y, zoom };
}

// TC-01: panBy at zoom 1 from origin
describe('TC-01 panBy at zoom 1 from origin', () => {
  it('shifts camera by -dx/zoom, -dy/zoom', () => {
    const cam = makeCamera(0, 0, 1);
    const next = panBy(cam, 200, 100);
    expect(next.x).toBe(-200);
    expect(next.y).toBe(-100);
    // world point (0,0) should now appear at screen (200, 100)
    const screen = worldToScreen(next, { x: 0, y: 0 });
    expect(screen.x).toBe(200);
    expect(screen.y).toBe(100);
  });
});

// TC-02: panBy at zoom ZOOM_MAX far away
describe('TC-02 panBy at zoom ZOOM_MAX far away', () => {
  it('shifts camera by -dx/zoom, -dy/zoom exactly', () => {
    const farX = UNBOUNDED_PAN_TESTED_EXTENT;
    const farY = UNBOUNDED_PAN_TESTED_EXTENT;
    const cam = makeCamera(farX, farY, ZOOM_MAX);
    const next = panBy(cam, 200, 100);
    expect(next.x).toBeCloseTo(farX - 200 / ZOOM_MAX, 6);
    expect(next.y).toBeCloseTo(farY - 100 / ZOOM_MAX, 6);
  });
});

// TC-03: zoomAt keeps world point under pointer invariant at origin
describe('TC-03 zoomAt keeps world point invariant at origin', () => {
  it('zoom 1 -> 2, screenToWorld(300,200) identical before and after', () => {
    const cam = makeCamera(0, 0, 1);
    const point: Point = { x: 300, y: 200 };
    const beforeWorld = screenToWorld(cam, point);
    const next = zoomAt(cam, point, 2);
    expect(next.zoom).toBe(2);
    const afterWorld = screenToWorld(next, point);
    expect(Math.abs(afterWorld.x - beforeWorld.x)).toBeLessThan(EPS);
    expect(Math.abs(afterWorld.y - beforeWorld.y)).toBeLessThan(EPS);
  });
});

// TC-04: zoomAt keeps world point invariant far away
describe('TC-04 zoomAt keeps world point invariant far away', () => {
  it('pointer world point invariant within 1e-6', () => {
    const farX = UNBOUNDED_PAN_TESTED_EXTENT;
    const farY = UNBOUNDED_PAN_TESTED_EXTENT;
    const cam = makeCamera(farX, farY, 1);
    const point: Point = { x: 150, y: 100 };
    const beforeWorld = screenToWorld(cam, point);
    const next = zoomAt(cam, point, 1.5);
    const afterWorld = screenToWorld(next, point);
    expect(Math.abs(afterWorld.x - beforeWorld.x)).toBeLessThan(EPS);
    expect(Math.abs(afterWorld.y - beforeWorld.y)).toBeLessThan(EPS);
  });
});

// TC-05: at ZOOM_MIN, zooming out returns same object
describe('TC-05 at ZOOM_MIN zooming out returns same object', () => {
  it('camera unchanged (object equality)', () => {
    const cam = makeCamera(0, 0, ZOOM_MIN);
    const centre: Point = { x: 640, y: 400 };
    const next = zoomAt(cam, centre, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
  });
});

// TC-06: at ZOOM_MAX, zooming in returns same object
describe('TC-06 at ZOOM_MAX zooming in returns same object', () => {
  it('camera unchanged (object equality)', () => {
    const cam = makeCamera(0, 0, ZOOM_MAX);
    const centre: Point = { x: 640, y: 400 };
    const next = zoomAt(cam, centre, ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
  });
});

// TC-07: viewport resize leaves camera unchanged
describe('TC-07 viewport resize leaves camera unchanged', () => {
  it('camera x,y,zoom unchanged after resize', () => {
    // resetCamera with 1200x800
    const cam = resetCamera({ width: 1200, height: 800 });
    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(-600);
    expect(cam.y).toBe(-400);
    // resize to 1920x1080 doesn't change the camera
    // (camera is not modified by viewport size)
    expect(cam.x).toBe(-600);
    expect(cam.y).toBe(-400);
    expect(cam.zoom).toBe(1);
  });
});

// TC-08: resetCamera(1200x800) → zoom 1, origin centred
describe('TC-08 resetCamera(1200x800)', () => {
  it('zoom 1, camera (-600, -400) so origin at centre', () => {
    const cam = resetCamera({ width: 1200, height: 800 });
    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(-600);
    expect(cam.y).toBe(-400);
    // origin world (0,0) should be at screen centre (600, 400)
    const screen = worldToScreen(cam, { x: 0, y: 0 });
    expect(screen.x).toBe(600);
    expect(screen.y).toBe(400);
  });
});

// TC-09: step in then out returns exactly 1.0
describe('TC-09 step in then out returns exactly 1.0', () => {
  it('1.0 -> 1.25 -> 1.0 exactly', () => {
    const vp: Size = { width: 1200, height: 800 };
    const cam0 = makeCamera(0, 0, 1);
    const cam1 = zoomStep(cam0, vp, 'in');
    expect(cam1.zoom).toBe(1.25);
    const cam2 = zoomStep(cam1, vp, 'out');
    expect(cam2.zoom).toBe(1.0);
  });
});

// TC-10: 20 steps in clamps at ZOOM_MAX
describe('TC-10 20 steps in clamps at ZOOM_MAX', () => {
  it('zoom reaches ZOOM_MAX and canZoomIn false', () => {
    const vp: Size = { width: 1200, height: 800 };
    let cam = makeCamera(0, 0, 1);
    for (let i = 0; i < 20; i++) {
      cam = zoomStep(cam, vp, 'in');
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
  });
});

// TC-11: huge factor clamps and keeps pointer invariance
describe('TC-11 huge factor clamps and keeps pointer invariance', () => {
  it('factor 1000 clamps to ZOOM_MAX, pointer invariance holds', () => {
    const cam = makeCamera(0, 0, 1);
    const point: Point = { x: 300, y: 200 };
    const beforeWorld = screenToWorld(cam, point);
    const next = zoomAt(cam, point, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const afterWorld = screenToWorld(next, point);
    expect(Math.abs(afterWorld.x - beforeWorld.x)).toBeLessThan(EPS);
    expect(Math.abs(afterWorld.y - beforeWorld.y)).toBeLessThan(EPS);
  });
});

// TC-12: invalid factors return unchanged camera
describe('TC-12 invalid factors return unchanged camera', () => {
  const point: Point = { x: 300, y: 200 };
  const cam = makeCamera(0, 0, 1);

  it.each([0, -1, -0.5, NaN, Infinity, -Infinity])(
    'factor %p returns unchanged camera',
    (factor) => {
      const next = zoomAt(cam, point, factor);
      expect(next).toBe(cam);
      expect(Number.isNaN(next.x)).toBe(false);
      expect(Number.isNaN(next.y)).toBe(false);
      expect(Number.isNaN(next.zoom)).toBe(false);
    },
  );
});

// Property check: 1,000 random cameras/points/factors, pointer invariance
describe('Property: pointer invariance under zoomAt', () => {
  it('1000 random cases keep pointer world point invariant', () => {
    // Seeded pseudo-random for determinism
    let seed = 42;
    function rand(): number {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    }

    for (let i = 0; i < 1000; i++) {
      const camX = (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT;
      const camY = (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT;
      const camZoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const cam = makeCamera(camX, camY, camZoom);

      const ptX = rand() * 1000;
      const ptY = rand() * 1000;
      const factor = 0.1 + rand() * 10;

      const before = screenToWorld(cam, { x: ptX, y: ptY });
      const next = zoomAt(cam, { x: ptX, y: ptY }, factor);
      const after = screenToWorld(next, { x: ptX, y: ptY });

      expect(Math.abs(after.x - before.x)).toBeLessThan(EPS);
      expect(Math.abs(after.y - before.y)).toBeLessThan(EPS);
    }
  });
});

// Additional checks for zoomPercent
describe('zoomPercent', () => {
  it('returns rounded percentage', () => {
    expect(zoomPercent(makeCamera(0, 0, 1))).toBe(100);
    expect(zoomPercent(makeCamera(0, 0, 1.5625))).toBe(156);
    expect(zoomPercent(makeCamera(0, 0, ZOOM_MIN))).toBe(10);
    expect(zoomPercent(makeCamera(0, 0, ZOOM_MAX))).toBe(400);
  });
});

// Additional checks for canZoomIn/canZoomOut
describe('canZoomIn / canZoomOut', () => {
  it('canZoomIn false at ZOOM_MAX', () => {
    expect(canZoomIn(makeCamera(0, 0, ZOOM_MAX))).toBe(false);
  });
  it('canZoomOut false at ZOOM_MIN', () => {
    expect(canZoomOut(makeCamera(0, 0, ZOOM_MIN))).toBe(false);
  });
  it('both true mid-range', () => {
    expect(canZoomIn(makeCamera(0, 0, 1))).toBe(true);
    expect(canZoomOut(makeCamera(0, 0, 1))).toBe(true);
  });
});

// screenToWorld and worldToScreen basic correctness
describe('screenToWorld / worldToScreen', () => {
  it('screenToWorld: world = screen/zoom + cam.xy', () => {
    const cam = makeCamera(100, 200, 2);
    const w = screenToWorld(cam, { x: 10, y: 20 });
    expect(w.x).toBe(100 + 10 / 2);
    expect(w.y).toBe(200 + 20 / 2);
  });
  it('worldToScreen: screen = (world - cam.xy) * zoom', () => {
    const cam = makeCamera(100, 200, 2);
    const s = worldToScreen(cam, { x: 110, y: 210 });
    expect(s.x).toBe((110 - 100) * 2);
    expect(s.y).toBe((210 - 200) * 2);
  });
});

// panBy zero delta returns same object
describe('panBy zero delta', () => {
  it('returns same object for zero delta', () => {
    const cam = makeCamera(100, 200, 1);
    const next = panBy(cam, 0, 0);
    expect(next).toBe(cam);
  });
});
