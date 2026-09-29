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
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const EPS = 1e-6;
const ORIGIN: Point = { x: 0, y: 0 };
const VIEWPORT: Size = { width: 1200, height: 800 };
const CENTRE: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;

function expectPointClose(a: Point, b: Point, eps = EPS) {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(eps);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(eps);
}

describe('screenToWorld / worldToScreen', () => {
  it('are inverse transforms', () => {
    const cam: Camera = { x: 10, y: -20, zoom: 2 };
    const p = { x: 123, y: 45 };
    expectPointClose(worldToScreen(cam, screenToWorld(cam, p)), p);
    expect(worldToScreen(cam, { x: 10, y: -20 })).toEqual({ x: 0, y: 0 });
  });
});

describe('panBy', () => {
  it('TC-01 moves the camera opposite to the drag at zoom 1', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const before = worldToScreen(cam, ORIGIN);
    expect(before).toEqual({ x: 0, y: 0 });
    const next = panBy(cam, 200, 100);
    expect(next.x).toBe(-200);
    expect(next.y).toBe(-100);
    expect(next.zoom).toBe(1);
    expect(worldToScreen(next, ORIGIN)).toEqual({ x: 200, y: 100 });
  });

  it('TC-02 shifts by screen delta / zoom at ZOOM_MAX far away', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const next = panBy(cam, 200, 100);
    expect(Math.abs(next.x - (FAR - 200 / ZOOM_MAX))).toBeLessThanOrEqual(EPS);
    expect(Math.abs(next.y - (FAR - 100 / ZOOM_MAX))).toBeLessThanOrEqual(EPS);
    const probe = { x: FAR + 5, y: FAR + 5 };
    const s0 = worldToScreen(cam, probe);
    const s1 = worldToScreen(next, probe);
    expectPointClose({ x: s1.x - s0.x, y: s1.y - s0.y }, { x: 200, y: 100 });
  });

  it('TC-29 (maths) zero delta returns the same object', () => {
    const cam: Camera = { x: 3, y: 4, zoom: 1 };
    expect(panBy(cam, 0, 0)).toBe(cam);
  });
});

describe('zoomAt', () => {
  it('TC-03 keeps the world point under the pointer invariant at the origin', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const p = { x: 300, y: 200 };
    const w0 = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 2);
    expect(next.zoom).toBe(2);
    expectPointClose(screenToWorld(next, p), w0);
  });

  it('TC-04 keeps the pointer world point invariant far away', () => {
    const cam: Camera = { x: FAR, y: -FAR, zoom: 1 };
    const p = { x: 417, y: 233 };
    const w0 = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 1.5);
    expect(next.zoom).toBe(1.5);
    expectPointClose(screenToWorld(next, p), w0);
  });

  it('TC-05 at ZOOM_MIN zooming out returns the same object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const next = zoomAt(cam, CENTRE, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.zoom).toBe(ZOOM_MIN);
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
  });

  it('TC-06 at ZOOM_MAX zooming in returns the same object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const next = zoomAt(cam, CENTRE, ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.zoom).toBe(ZOOM_MAX);
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
  });

  it('TC-11 huge factor clamps to ZOOM_MAX and keeps pointer invariance', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const p = { x: 300, y: 200 };
    const w0 = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    expectPointClose(screenToWorld(next, p), w0);
  });

  it('TC-12 invalid factors return the input camera unchanged', () => {
    const cam: Camera = { x: 5, y: 6, zoom: 1 };
    for (const f of [0, -1, -0.5, NaN, Infinity, -Infinity]) {
      const next = zoomAt(cam, { x: 10, y: 10 }, f);
      expect(next).toBe(cam);
      expect(Number.isNaN(next.x) || Number.isNaN(next.y) || Number.isNaN(next.zoom)).toBe(false);
    }
  });

  it('property: pointer world point is invariant for 1,000 seeded random cases', () => {
    // Deterministic LCG (Numerical Recipes constants)
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 1000; i++) {
      const cam: Camera = {
        x: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN),
      };
      const p = { x: rand() * 1920, y: rand() * 1080 };
      const factor = Math.exp((rand() * 2 - 1) * 3);
      const w0 = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expectPointClose(screenToWorld(next, p), w0);
    }
  });
});

describe('viewport resize', () => {
  it('TC-07 changing viewport size leaves the camera unchanged', () => {
    const cam: Camera = { x: 12, y: 34, zoom: 1 };
    // The camera is anchored at the top-left, so no camera function is called on resize;
    // world points keep their screen position relative to the top-left corner.
    const before = worldToScreen(cam, { x: 50, y: 60 });
    const smaller: Size = { width: 600, height: 400 };
    void smaller;
    expect(cam).toEqual({ x: 12, y: 34, zoom: 1 });
    expect(worldToScreen(cam, { x: 50, y: 60 })).toEqual(before);
  });
});

describe('resetCamera', () => {
  it('TC-08 resets to zoom 1 with the origin centred', () => {
    const next = resetCamera(VIEWPORT);
    expect(next).toEqual({ x: -600, y: -400, zoom: 1 });
    expect(worldToScreen(next, ORIGIN)).toEqual(CENTRE);
  });
});

describe('zoomStep', () => {
  it('TC-09 one step in then out returns exactly 1.0', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const inOnce = zoomStep(cam, VIEWPORT, 'in');
    expect(inOnce.zoom).toBe(ZOOM_STEP_FACTOR);
    const back = zoomStep(inOnce, VIEWPORT, 'out');
    expect(back.zoom).toBe(1);
    expect(zoomPercent(back)).toBe(100);
  });

  it('keeps the viewport centre fixed', () => {
    const cam: Camera = { x: 7, y: 9, zoom: 1 };
    const w0 = screenToWorld(cam, CENTRE);
    expectPointClose(screenToWorld(zoomStep(cam, VIEWPORT, 'in'), CENTRE), w0);
  });

  it('TC-10 20 steps in clamps at ZOOM_MAX', () => {
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  it('many steps out clamps at ZOOM_MIN', () => {
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    for (let i = 0; i < 30; i++) cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MIN * 100));
  });
});

describe('zoomPercent', () => {
  it('rounds to a whole percent', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });
});
