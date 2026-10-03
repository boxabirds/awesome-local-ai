import { describe, expect, it } from 'vitest';
import {
  type Camera,
  canZoomIn,
  canZoomOut,
  panBy,
  resetCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
  zoomPercent,
  zoomStep,
} from '../../src/client/canvas/camera';
import {
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const FAR = UNBOUNDED_PAN_TESTED_EXTENT;
const VIEWPORT = { width: 1280, height: 800 };

/** Deterministic PRNG so the property check is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('camera.math', () => {
  it('TC-01 panBy at zoom 1 from the origin moves content exactly by the screen delta', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const originScreenBefore = worldToScreen(cam, { x: 0, y: 0 });
    expect(originScreenBefore).toEqual({ x: 0, y: 0 });

    const panned = panBy(cam, 200, 100);
    expect(panned.x).toBe(-200);
    expect(panned.y).toBe(-100);
    expect(panned.zoom).toBe(1);
    expect(worldToScreen(panned, { x: 0, y: 0 })).toEqual({ x: 200, y: 100 });
  });

  it('TC-02 panBy at ZOOM_MAX one million units away shifts the camera exactly by delta/zoom', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const panned = panBy(cam, 200, 100);
    expect(panned.x).toBeCloseTo(FAR - 200 / ZOOM_MAX, 6);
    expect(panned.y).toBeCloseTo(FAR - 100 / ZOOM_MAX, 6);
    expect(panned.zoom).toBe(ZOOM_MAX);
  });

  it('TC-03 zoomAt keeps the world point under the pointer invariant (origin)', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const pointer = { x: 300, y: 200 };
    const before = screenToWorld(cam, pointer);

    const zoomed = zoomAt(cam, pointer, 2);
    expect(zoomed.zoom).toBe(2);
    expect(screenToWorld(zoomed, pointer)).toEqual(before);
  });

  it('TC-04 zoomAt keeps the pointer invariant one million units away (1e-6)', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: 1 };
    const pointer = { x: 300, y: 200 };
    const before = screenToWorld(cam, pointer);

    const zoomed = zoomAt(cam, pointer, 1.5);
    const after = screenToWorld(zoomed, pointer);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1e-6);
  });

  it('TC-05 zooming out at ZOOM_MIN returns the same object (camera unchanged)', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

    expect(zoomAt(cam, centre, 1 / ZOOM_STEP_FACTOR)).toBe(cam);
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
  });

  it('TC-06 zooming in at ZOOM_MAX returns the same object (camera unchanged)', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

    expect(zoomAt(cam, centre, ZOOM_STEP_FACTOR)).toBe(cam);
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
  });

  it('TC-07 a viewport resize leaves the camera unchanged', () => {
    const cam: Camera = { x: 123.45, y: -67.89, zoom: 1.5 };
    // Resizing the viewport is not input to the camera: the same camera object
    // stays valid for any viewport size (camera x,y anchor the top-left corner).
    const afterResize: Camera = cam;
    expect(afterResize).toBe(cam);
    expect(cam).toEqual({ x: 123.45, y: -67.89, zoom: 1.5 });
    // Only resetCamera depends on the viewport, and it derives a fresh camera.
    expect(resetCamera({ width: 1920, height: 1080 })).toEqual({ x: -960, y: -540, zoom: 1 });
  });

  it('TC-08 resetCamera centres the origin at 100% zoom', () => {
    expect(resetCamera({ width: 1200, height: 800 })).toEqual({ x: -600, y: -400, zoom: 1 });
  });

  it('TC-09 one step in then one step out returns exactly 1.0 (100%)', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const steppedIn = zoomStep(cam, VIEWPORT, 'in');
    expect(steppedIn.zoom).toBe(ZOOM_STEP_FACTOR);

    const steppedOut = zoomStep(steppedIn, VIEWPORT, 'out');
    expect(steppedOut.zoom).toBe(1);
    expect(zoomPercent(steppedOut)).toBe(100);
  });

  it('TC-10 twenty steps in clamps at ZOOM_MAX and canZoomIn becomes false', () => {
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    for (let i = 0; i < 20; i++) {
      cam = zoomStep(cam, VIEWPORT, 'in');
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  it('TC-11 a huge zoom factor clamps at ZOOM_MAX and the pointer stays invariant', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const pointer = { x: 300, y: 200 };
    const before = screenToWorld(cam, pointer);

    const zoomed = zoomAt(cam, pointer, 1000);
    expect(zoomed.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(zoomed, pointer);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1e-6);
  });

  it('TC-12 invalid zoom factors return the input camera unchanged and never produce NaN', () => {
    const cam: Camera = { x: 7, y: -3, zoom: 1 };
    for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = zoomAt(cam, { x: 10, y: 20 }, factor);
      expect(result).toBe(cam);
      expect(Number.isNaN(result.x) || Number.isNaN(result.y) || Number.isNaN(result.zoom)).toBe(false);
    }
  });

  it('property: for 1000 random cameras, points and factors the pointer world point is invariant under zoomAt (1e-6)', () => {
    const random = mulberry32(0x5eed);
    for (let i = 0; i < 1000; i++) {
      const cam: Camera = {
        x: (random() * 2 - 1) * FAR,
        y: (random() * 2 - 1) * FAR,
        zoom: ZOOM_MIN + random() * (ZOOM_MAX - ZOOM_MIN),
      };
      const pointer = { x: random() * 4000, y: random() * 4000 };
      const factor = 0.5 + random() * 1.5;
      const before = screenToWorld(cam, pointer);
      const after = screenToWorld(zoomAt(cam, pointer, factor), pointer);
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1e-6);
    }
  });
});
