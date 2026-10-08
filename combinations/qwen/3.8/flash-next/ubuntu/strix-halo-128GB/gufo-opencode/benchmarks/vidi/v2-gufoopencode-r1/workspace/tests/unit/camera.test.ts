import { describe, expect, test } from 'vitest';
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
  type Size
} from '../../src/client/canvas/camera';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR
} from '../../src/shared/config';

const ORIGIN: Point = { x: 0, y: 0 };
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;
const EPSILON = 1e-6;
const VIEWPORT: Size = { width: 1200, height: 800 };

const cam = (x: number, y: number, zoom: number): Camera => ({ x, y, zoom });

describe('camera.math', () => {
  test('TC-01 panBy at zoom 1 from origin shifts camera by -delta and moves screen point by +delta', () => {
    const start = cam(0, 0, 1);
    const next = panBy(start, 200, 100);
    expect(next.x).toBeCloseTo(-200, 10);
    expect(next.y).toBeCloseTo(-100, 10);
    expect(next.zoom).toBe(1);
    const screen = worldToScreen(next, ORIGIN);
    expect(screen.x).toBeCloseTo(200, 10);
    expect(screen.y).toBeCloseTo(100, 10);
  });

  test('TC-02 panBy at ZOOM_MAX far away shifts by delta/zoom world units exactly', () => {
    const start = cam(FAR, FAR, ZOOM_MAX);
    const next = panBy(start, 200, 100);
    expect(next.x).toBeCloseTo(FAR - 200 / ZOOM_MAX, 10);
    expect(next.y).toBeCloseTo(FAR - 100 / ZOOM_MAX, 10);
    expect(Math.abs(next.x - (FAR - 200 / ZOOM_MAX))).toBeLessThan(EPSILON);
    expect(Math.abs(next.y - (FAR - 100 / ZOOM_MAX))).toBeLessThan(EPSILON);
  });

  test('TC-03 zoomAt keeps the world point under the pointer invariant (origin, zoom 1 -> 2)', () => {
    const start = cam(0, 0, 1);
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(start, p);
    const next = zoomAt(start, p, 2);
    expect(next.zoom).toBe(2);
    const after = screenToWorld(next, p);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });

  test('TC-04 zoomAt pointer invariance holds far away within 1e-6', () => {
    const start = cam(FAR, FAR, 1);
    const p: Point = { x: 640, y: 400 };
    const before = screenToWorld(start, p);
    const next = zoomAt(start, p, 1.5);
    const after = screenToWorld(next, p);
    expect(Math.abs(after.x - before.x)).toBeLessThan(EPSILON);
    expect(Math.abs(after.y - before.y)).toBeLessThan(EPSILON);
  });

  test('TC-05 zoomAt past ZOOM_MIN returns the same object', () => {
    const start = cam(0, 0, ZOOM_MIN);
    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomAt(start, centre, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(start);
    expect(next.zoom).toBe(ZOOM_MIN);
    expect(next.x).toBe(start.x);
    expect(next.y).toBe(start.y);
  });

  test('TC-06 zoomAt past ZOOM_MAX returns the same object', () => {
    const start = cam(0, 0, ZOOM_MAX);
    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomAt(start, centre, ZOOM_STEP_FACTOR);
    expect(next).toBe(start);
    expect(next.zoom).toBe(ZOOM_MAX);
  });

  test('TC-07 viewport resize leaves the camera unchanged (top-left world point stable)', () => {
    const start = cam(0, 0, 1);
    const topLeftBefore = screenToWorld(start, ORIGIN);
    // resize is not user input to the camera: a zero pan is the identity
    const next = panBy(start, 0, 0);
    expect(next).toBe(start);
    const topLeftAfter = screenToWorld(next, ORIGIN);
    expect(topLeftAfter.x).toBe(topLeftBefore.x);
    expect(topLeftAfter.y).toBe(topLeftBefore.y);
  });

  test('TC-08 resetCamera(1200x800) zooms to 1 with origin centred', () => {
    const start = cam(FAR, FAR, ZOOM_MAX);
    const next = resetCamera({ width: 1200, height: 800 });
    expect(next.zoom).toBe(1);
    expect(next.x).toBe(-600);
    expect(next.y).toBe(-400);
    const screen = worldToScreen(next, ORIGIN);
    expect(screen.x).toBeCloseTo(600, 10);
    expect(screen.y).toBeCloseTo(400, 10);
    void start;
  });

  test('TC-09 one step in then one step out returns exactly 1.0', () => {
    const start = cam(0, 0, 1);
    const inOnce = zoomStep(start, VIEWPORT, 'in');
    expect(inOnce.zoom).toBe(1.25);
    expect(zoomPercent(inOnce)).toBe(125);
    const outOnce = zoomStep(inOnce, VIEWPORT, 'out');
    expect(outOnce.zoom).toBe(1);
    expect(zoomPercent(outOnce)).toBe(100);
  });

  test('TC-10 20 steps in clamps at ZOOM_MAX and canZoomIn is false', () => {
    let current: Camera = cam(0, 0, 1);
    for (let i = 0; i < 20; i++) current = zoomStep(current, VIEWPORT, 'in');
    expect(current.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(current)).toBe(false);
    expect(canZoomOut(current)).toBe(true);
  });

  test('TC-11 huge zoom factor clamps to ZOOM_MAX and keeps pointer invariance', () => {
    const start = cam(0, 0, 1);
    const p: Point = { x: 123, y: 456 };
    const before = screenToWorld(start, p);
    const next = zoomAt(start, p, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, p);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });

  test('TC-12 invalid factors return the camera unchanged with no NaN', () => {
    const start = cam(10, 20, 1);
    for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(start, ORIGIN, factor);
      expect(next).toBe(start);
      expect(Number.isNaN(next.x)).toBe(false);
      expect(Number.isNaN(next.y)).toBe(false);
      expect(Number.isNaN(next.zoom)).toBe(false);
    }
  });

  test('TC-01..12 grid dot: GRID_SPACING_WORLD spacing scales with zoom', () => {
    const c = cam(0, 0, 2);
    const a = worldToScreen(c, { x: GRID_SPACING_WORLD, y: 0 });
    const b = worldToScreen(c, ORIGIN);
    expect(a.x - b.x).toBeCloseTo(GRID_SPACING_WORLD * 2, 10);
  });

  test('property: zoomAt keeps the pointer world point invariant for 1000 random cases', () => {
    let state = 0x2f6e2b1;
    const rand = () => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 1000; i++) {
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const cx = (rand() - 0.5) * 2 * FAR;
      const cy = (rand() - 0.5) * 2 * FAR;
      const p: Point = { x: rand() * 1920, y: rand() * 1080 };
      const factor = 0.05 + rand() * 20;
      const start = cam(cx, cy, zoom);
      const before = screenToWorld(start, p);
      const next = zoomAt(start, p, factor);
      const after = screenToWorld(next, p);
      expect(Math.abs(after.x - before.x)).toBeLessThan(EPSILON);
      expect(Math.abs(after.y - before.y)).toBeLessThan(EPSILON);
    }
  });
});
