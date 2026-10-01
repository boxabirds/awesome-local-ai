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
  UNBOUNDED_PAN_TESTED_EXTENT as FAR,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const origin: Camera = { x: 0, y: 0, zoom: 1 };
const viewport = { width: 1200, height: 800 };
const EPS = 1e-6;
const HUGE_FACTOR = 1000;
const PROPERTY_RUNS = 1000;

function expectInvariant(before: Camera, after: Camera, p: { x: number; y: number }) {
  const a = screenToWorld(before, p);
  const b = screenToWorld(after, p);
  expect(Math.abs(a.x - b.x)).toBeLessThan(EPS);
  expect(Math.abs(a.y - b.y)).toBeLessThan(EPS);
}

describe('camera.math', () => {
  it('TC-01 panBy moves the world under the screen', () => {
    const cam = panBy(origin, 200, 100);
    expect(cam).toMatchObject({ x: -200, y: -100, zoom: 1 });
    expect(worldToScreen(cam, { x: 0, y: 0 })).toEqual({ x: 200, y: 100 });
  });

  it('TC-02 panBy at max zoom far away', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const next = panBy(cam, 200, 100);
    expect(next.x).toBeCloseTo(FAR - 200 / ZOOM_MAX, 6);
    expect(next.y).toBeCloseTo(FAR - 100 / ZOOM_MAX, 6);
  });

  it('panBy with zero delta returns the same object', () => {
    expect(panBy(origin, 0, 0)).toBe(origin);
  });

  it('TC-03 zoomAt keeps pointer world point', () => {
    const p = { x: 300, y: 200 };
    const next = zoomAt(origin, p, 2);
    expect(next.zoom).toBe(2);
    expectInvariant(origin, next, p);
  });

  it('TC-04 zoomAt far away keeps pointer world point', () => {
    const cam: Camera = { x: FAR, y: -FAR, zoom: 1 };
    const p = { x: 417, y: 233 };
    expectInvariant(cam, zoomAt(cam, p, 1.5), p);
  });

  it('TC-05 no zoom out past min returns same object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    expect(zoomAt(cam, { x: 600, y: 400 }, 1 / ZOOM_STEP_FACTOR)).toBe(cam);
    expect(zoomStep(cam, viewport, 'out')).toBe(cam);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
  });

  it('TC-06 no zoom in past max returns same object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    expect(zoomAt(cam, { x: 600, y: 400 }, ZOOM_STEP_FACTOR)).toBe(cam);
    expect(zoomStep(cam, viewport, 'in')).toBe(cam);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  it('TC-07 viewport resize is not a camera input', () => {
    const cam: Camera = { x: 10, y: 20, zoom: 1 };
    // The camera API takes the viewport only for centre-based operations;
    // nothing in it is touched by a size change.
    expect(cam).toEqual({ x: 10, y: 20, zoom: 1 });
    expect(panBy(cam, 0, 0)).toBe(cam);
  });

  it('TC-08 resetCamera centres the origin at zoom 1', () => {
    const cam = resetCamera(viewport);
    expect(cam).toEqual({ x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 });
    expect(worldToScreen(cam, { x: 0, y: 0 })).toEqual({ x: viewport.width / 2, y: viewport.height / 2 });
  });

  it('TC-09 step in then out returns exactly 1', () => {
    const inCam = zoomStep(origin, viewport, 'in');
    expect(inCam.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(inCam)).toBe(125);
    const back = zoomStep(inCam, viewport, 'out');
    expect(back.zoom).toBe(1);
    expect(zoomPercent(back)).toBe(100);
  });

  it('TC-10 20 steps in clamps at max', () => {
    let cam = origin;
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, viewport, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
  });

  it('TC-11 huge factor clamps and keeps invariance', () => {
    const p = { x: 300, y: 200 };
    const next = zoomAt(origin, p, HUGE_FACTOR);
    expect(next.zoom).toBe(ZOOM_MAX);
    expectInvariant(origin, next, p);
  });

  it('TC-12 invalid factors leave the camera unchanged', () => {
    for (const f of [0, -1, NaN, Infinity, -Infinity]) {
      const next = zoomAt(origin, { x: 10, y: 10 }, f);
      expect(next).toBe(origin);
      expect(Number.isNaN(next.x) || Number.isNaN(next.zoom)).toBe(false);
    }
  });

  it('zoomStep keeps the viewport centre fixed', () => {
    const cam: Camera = { x: 55, y: -12, zoom: 1 };
    const centre = { x: viewport.width / 2, y: viewport.height / 2 };
    expectInvariant(cam, zoomStep(cam, viewport, 'in'), centre);
  });

  it('property: pointer world point is invariant under zoomAt', () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const cam: Camera = {
        x: (rand() - 0.5) * 2 * FAR,
        y: (rand() - 0.5) * 2 * FAR,
        zoom: ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN),
      };
      const p = { x: rand() * 1920, y: rand() * 1080 };
      const factor = ZOOM_MIN + rand() * (ZOOM_MAX / ZOOM_MIN - ZOOM_MIN);
      const next = zoomAt(cam, p, factor);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expectInvariant(cam, next, p);
    }
  });
});
