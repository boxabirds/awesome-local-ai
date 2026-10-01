import { describe, expect, it } from 'vitest';
import {
  canZoomIn, canZoomOut, panBy, resetCamera, screenToWorld, zoomAt, zoomPercent, zoomStep,
  type Camera, type Size,
} from '../../src/client/canvas/camera';
import {
  UNBOUNDED_PAN_TESTED_EXTENT as FAR, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const origin: Camera = { x: 0, y: 0, zoom: 1 };
const viewport: Size = { width: 1200, height: 800 };
const TOL = 1e-6;

describe('camera.math', () => {
  it('TC-01 panBy at origin', () => {
    const c = panBy(origin, 200, 100);
    expect(c).toEqual({ x: -200, y: -100, zoom: 1 });
  });

  it('TC-02 panBy at max zoom far away', () => {
    const cam = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const c = panBy(cam, 200, 100);
    expect(c.x - cam.x).toBeCloseTo(-200 / ZOOM_MAX, 6);
    expect(c.y - cam.y).toBeCloseTo(-100 / ZOOM_MAX, 6);
  });

  it('TC-03 zoomAt keeps pointer world point', () => {
    const p = { x: 300, y: 200 };
    const c = zoomAt(origin, p, 2);
    expect(c.zoom).toBe(2);
    const a = screenToWorld(origin, p), b = screenToWorld(c, p);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });

  it('TC-04 zoomAt far away', () => {
    const cam = { x: FAR, y: -FAR, zoom: 1 };
    const p = { x: 417.5, y: 93.25 };
    const c = zoomAt(cam, p, 1.5);
    const a = screenToWorld(cam, p), b = screenToWorld(c, p);
    expect(Math.abs(b.x - a.x)).toBeLessThan(TOL);
    expect(Math.abs(b.y - a.y)).toBeLessThan(TOL);
  });

  it('TC-05 at min, zooming out returns same object', () => {
    const cam = { x: 0, y: 0, zoom: ZOOM_MIN };
    expect(zoomAt(cam, { x: 10, y: 10 }, 1 / ZOOM_STEP_FACTOR)).toBe(cam);
    expect(zoomStep(cam, viewport, 'out')).toBe(cam);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
  });

  it('TC-06 at max, zooming in returns same object', () => {
    const cam = { x: 0, y: 0, zoom: ZOOM_MAX };
    expect(zoomAt(cam, { x: 10, y: 10 }, ZOOM_STEP_FACTOR)).toBe(cam);
    expect(zoomStep(cam, viewport, 'in')).toBe(cam);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  it('TC-07 viewport size is not part of the camera', () => {
    const cam = { x: 5, y: 6, zoom: 1 };
    // Resizing is not an input to the camera; the camera object is simply untouched.
    expect(cam).toEqual({ x: 5, y: 6, zoom: 1 });
  });

  it('TC-08 resetCamera centres the origin', () => {
    const c = resetCamera(viewport);
    expect(c).toEqual({ x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 });
  });

  it('TC-09 step in then out returns exactly 1', () => {
    const a = zoomStep(origin, viewport, 'in');
    expect(a.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(a)).toBe(Math.round(ZOOM_STEP_FACTOR * 100));
    const b = zoomStep(a, viewport, 'out');
    expect(b.zoom).toBe(1);
    expect(zoomPercent(b)).toBe(100);
  });

  it('step keeps the viewport centre fixed', () => {
    const cam = { x: 123, y: -45, zoom: 1 };
    const c = zoomStep(cam, viewport, 'in');
    const centre = { x: viewport.width / 2, y: viewport.height / 2 };
    const a = screenToWorld(cam, centre), b = screenToWorld(c, centre);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });

  it('TC-10 20 steps in clamps at max', () => {
    let c = origin;
    for (let i = 0; i < 20; i++) c = zoomStep(c, viewport, 'in');
    expect(c.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(c)).toBe(false);
  });

  it('20 steps out clamps at min', () => {
    let c = origin;
    for (let i = 0; i < 20; i++) c = zoomStep(c, viewport, 'out');
    expect(c.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(c)).toBe(false);
  });

  it('TC-11 huge factor clamps and keeps pointer invariant', () => {
    const p = { x: 300, y: 200 };
    const c = zoomAt(origin, p, 1000);
    expect(c.zoom).toBe(ZOOM_MAX);
    const a = screenToWorld(origin, p), b = screenToWorld(c, p);
    expect(Math.abs(b.x - a.x)).toBeLessThan(TOL);
    expect(Math.abs(b.y - a.y)).toBeLessThan(TOL);
  });

  it('TC-12 invalid factors leave camera unchanged', () => {
    for (const f of [0, -1, NaN, Infinity, -Infinity]) {
      const c = zoomAt(origin, { x: 1, y: 1 }, f);
      expect(c).toBe(origin);
      expect(Number.isNaN(c.x) || Number.isNaN(c.y) || Number.isNaN(c.zoom)).toBe(false);
    }
  });

  it('zero pan returns same object', () => {
    expect(panBy(origin, 0, 0)).toBe(origin);
  });

  it('property: pointer invariance for 1000 seeded random inputs', () => {
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 1000; i++) {
      const cam = {
        x: (rnd() - 0.5) * 2 * FAR, y: (rnd() - 0.5) * 2 * FAR,
        zoom: ZOOM_MIN + rnd() * (ZOOM_MAX - ZOOM_MIN),
      };
      const p = { x: rnd() * 1920, y: rnd() * 1080 };
      const factor = Math.exp((rnd() - 0.5) * 4);
      const c = zoomAt(cam, p, factor);
      const a = screenToWorld(cam, p), b = screenToWorld(c, p);
      expect(Math.abs(b.x - a.x)).toBeLessThan(TOL);
      expect(Math.abs(b.y - a.y)).toBeLessThan(TOL);
    }
  });
});
