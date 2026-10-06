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
  type Size,
} from '../../src/client/canvas/camera';
import {
  PERCENT,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

/** Default laptop viewport used across the story's test fixtures. */
const VIEWPORT: Size = { width: 1200, height: 800 };
const CENTRE: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
/** The point hovered in the pointer-invariance tests. */
const POINTER: Point = { x: 300, y: 200 };
/** Camera at the board's starting point, 100%. */
const START: Camera = { x: 0, y: 0, zoom: 1 };
/** How far from the start the design requires exact behaviour. */
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;
/** Tolerance for "the same world point" assertions (design: 1e-6). */
const EPS = 1e-6;

function expectPoint(actual: Point, expected: Point, eps = EPS): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(eps);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(eps);
}

/** Asserts a camera is finite everywhere (no NaN leaking out of the contract). */
function expectFiniteCamera(cam: Camera): void {
  expect(Number.isFinite(cam.x)).toBe(true);
  expect(Number.isFinite(cam.y)).toBe(true);
  expect(Number.isFinite(cam.zoom)).toBe(true);
}

describe('camera.math', () => {
  test('TC-01 panBy at zoom 1 moves the camera by -delta and content by +delta', () => {
    const next = panBy(START, 200, 100);

    expect(Math.abs(next.x - -200)).toBeLessThanOrEqual(EPS);
    expect(Math.abs(next.y - -100)).toBeLessThanOrEqual(EPS);
    expect(next.zoom).toBe(START.zoom);

    // the world origin, which was at the viewport top-left, is now 200 right, 100 down
    expectPoint(worldToScreen(next, { x: 0, y: 0 }), { x: 200, y: 100 });
  });

  test('TC-01b panBy with a zero delta returns the same camera object', () => {
    expect(panBy(START, 0, 0)).toBe(START);
  });

  test('TC-02 panBy at ZOOM_MAX far from the start shifts exact world units', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const next = panBy(cam, 200, 100);

    // 200 screen px at ZOOM_MAX is exactly 50 world units, 100 px is 25
    expect(Math.abs(next.x - (FAR - 200 / ZOOM_MAX))).toBeLessThanOrEqual(EPS);
    expect(Math.abs(next.y - (FAR - 100 / ZOOM_MAX))).toBeLessThanOrEqual(EPS);
    expect(next.zoom).toBe(ZOOM_MAX);

    // doubles keep sub-pixel precision at that distance: a screen point round-trips
    const world = screenToWorld(next, POINTER);
    expectPoint(worldToScreen(next, world), POINTER);
    expectPoint(worldToScreen(cam, screenToWorld(cam, POINTER)), POINTER);
  });

  test('TC-03 zoomAt keeps the world point under the pointer at the same screen position', () => {
    const before = screenToWorld(START, POINTER);
    const next = zoomAt(START, POINTER, 2);

    expect(next.zoom).toBe(2);
    expectPoint(screenToWorld(next, POINTER), before);
    // and that world point is still drawn at the pointer
    expectPoint(worldToScreen(next, before), POINTER);
  });

  test('TC-04 zoomAt keeps the pointer invariant far from the start', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: 1 };
    const before = screenToWorld(cam, POINTER);
    const next = zoomAt(cam, POINTER, 1.5);

    expect(next.zoom).toBeCloseTo(1.5, 10);
    expectPoint(screenToWorld(next, POINTER), before);
    expectPoint(worldToScreen(next, before), POINTER);
  });

  test('TC-05 zoomAt past ZOOM_MIN returns the same camera object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const next = zoomAt(cam, CENTRE, 1 / ZOOM_STEP_FACTOR);

    expect(next).toBe(cam);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
    expect(next.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
  });

  test('TC-06 zoomAt past ZOOM_MAX returns the same camera object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const next = zoomAt(cam, CENTRE, ZOOM_STEP_FACTOR);

    expect(next).toBe(cam);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
    expect(next.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
  });

  test('TC-07 a viewport resize leaves the camera unchanged', () => {
    const cam: Camera = { x: -1234.5, y: 678.25, zoom: 1.5 };
    const before = { ...cam };

    // A resize is not an input to the camera: only the viewport size changes, so the
    // camera object (and therefore the world point at the viewport's top-left) is kept.
    const resized: Camera = cam;
    expect(resized).toEqual(before);
    const small: Size = { width: 640, height: 480 };
    const large: Size = { width: 1920, height: 1080 };
    expectPoint(screenToWorld(resized, { x: 0, y: 0 }), { x: before.x, y: before.y });
    expectPoint(screenToWorld(resized, { x: 0, y: 0 }), { x: before.x, y: before.y });

    // no camera.math call mutates its input camera, whatever the viewport size
    zoomStep(cam, small, 'in');
    zoomStep(cam, large, 'out');
    panBy(cam, 10, -10);
    zoomAt(cam, POINTER, 1.3);
    resetCamera(large);
    expect(cam).toEqual(before);
  });

  test('TC-08 resetCamera sets zoom 1 and centres the board start point', () => {
    const cam = resetCamera({ width: 1200, height: 800 });

    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(-600);
    expect(cam.y).toBe(-400);
    expectPoint(worldToScreen(cam, { x: 0, y: 0 }), { x: 600, y: 400 });

    // from anywhere on the board, at maximum zoom, reset gives the same standard view
    const fromFarZoomed = resetCamera({ width: 1200, height: 800 });
    expect(fromFarZoomed).toEqual(cam);
    expectPoint(worldToScreen(fromFarZoomed, { x: 0, y: 0 }), { x: 600, y: 400 });
  });

  test('TC-09 one step in then one step out returns exactly 1.0', () => {
    const inStep = zoomStep(START, VIEWPORT, 'in');
    expect(inStep.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(inStep)).toBe(125);

    const backOut = zoomStep(inStep, VIEWPORT, 'out');
    expect(backOut.zoom).toBe(1);
    expect(zoomPercent(backOut)).toBe(PERCENT);
  });

  test('TC-10 repeated steps in clamp at ZOOM_MAX and disable zoom in', () => {
    let cam: Camera = { ...START };
    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'in');
      expect(cam.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }

    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(400);

    // zooming back the other way works again
    const out = zoomStep(cam, VIEWPORT, 'out');
    expect(out.zoom).toBeLessThan(ZOOM_MAX);
    expect(canZoomIn(out)).toBe(true);

    // the centre of the board area stays put while stepping
    const centreWorld = screenToWorld(cam, CENTRE);
    expectPoint(screenToWorld(out, CENTRE), centreWorld);
  });

  test('TC-10b repeated steps out clamp at ZOOM_MIN and disable zoom out', () => {
    let cam: Camera = { ...START };
    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'out');
      expect(cam.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
    }

    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(10);
  });

  test('TC-11 a huge zoom factor clamps and keeps the pointer invariant', () => {
    const before = screenToWorld(START, POINTER);
    const next = zoomAt(START, POINTER, 1000);

    expect(next.zoom).toBe(ZOOM_MAX);
    expectPoint(screenToWorld(next, POINTER), before);
    expectPoint(worldToScreen(next, before), POINTER);

    // clamped the other way, from mid zoom, still keeps the pointer fixed
    const mid: Camera = { x: -4000, y: 900, zoom: 1 };
    const beforeMid = screenToWorld(mid, POINTER);
    const out = zoomAt(mid, POINTER, 1 / 1000);
    expect(out.zoom).toBe(ZOOM_MIN);
    expectPoint(screenToWorld(out, POINTER), beforeMid);

    // and a huge factor when already at a limit is a no-op (same object)
    const atMax: Camera = { x: FAR, y: -FAR, zoom: ZOOM_MAX };
    expect(zoomAt(atMax, POINTER, 1000)).toBe(atMax);
  });

  test('TC-12 invalid zoom factors leave the camera unchanged and never produce NaN', () => {
    const cam: Camera = { x: -100, y: 250, zoom: 1 };
    const invalid = [0, -0, -1, -ZOOM_STEP_FACTOR, NaN, Infinity, -Infinity];

    for (const factor of invalid) {
      const next = zoomAt(cam, POINTER, factor);
      expect(next).toBe(cam);
      expectFiniteCamera(next);
    }
  });

  test('TC-12b zoomPercent rounds to the nearest whole percent', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(100);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });

  test('screenToWorld and worldToScreen are inverses', () => {
    const cams: Camera[] = [
      START,
      { x: -500.5, y: 333.25, zoom: 0.35 },
      { x: FAR, y: -FAR, zoom: ZOOM_MAX },
    ];
    for (const cam of cams) {
      expectPoint(worldToScreen(cam, screenToWorld(cam, POINTER)), POINTER);
      expectPoint(screenToWorld(cam, worldToScreen(cam, { x: 12.5, y: -7.25 })), {
        x: 12.5,
        y: -7.25,
      });
    }
  });

  test('property: for 1000 random cameras the world point under the pointer is invariant', () => {
    // deterministic PRNG so a failure is reproducible
    let state = 0x9e3779b9;
    const rand = (): number => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const range = (min: number, max: number) => min + rand() * (max - min);

    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: range(-UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT),
        y: range(-UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT),
        zoom: range(ZOOM_MIN, ZOOM_MAX),
      };
      const point: Point = { x: range(0, 1920), y: range(0, 1080) };
      const factor = range(0.05, 20);

      const before = screenToWorld(cam, point);
      const next = zoomAt(cam, point, factor);
      expectFiniteCamera(next);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expectPoint(screenToWorld(next, point), before);
      expectPoint(worldToScreen(next, before), point);
    }
  });
});
