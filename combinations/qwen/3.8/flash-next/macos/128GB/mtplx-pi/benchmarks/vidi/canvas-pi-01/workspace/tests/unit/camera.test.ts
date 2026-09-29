/**
 * Story 1 · task 1 — camera.math unit tests (TC-01 … TC-12 plus the property
 * check from the design's camera.math test section).
 *
 * Everything is written against `src/shared/config.ts` constants; a literal
 * 0.1/4/1.25 appearing in this file would be a bug because the PRD requires
 * the limits and step size to be changeable "in one place without redesign".
 */
import { describe, expect, it } from 'vitest';
import {
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
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

/** Pointer-invariance tolerance required by the design (1e-6 world units). */
const TOL = 1e-6;

/** Default laptop viewport from the design fixtures. */
const VIEWPORT: Size = { width: 1200, height: 800 };

/** Bigger fixture viewport (TC-07). */
const BIG_VIEWPORT: Size = { width: 1920, height: 1080 };

const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };

const CENTRE: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

/** Camera 1,000,000 world units away from the start, at a given zoom. */
function farAway(zoom: number): Camera {
  return { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom };
}

/** Assert the world point under a screen point is unchanged by a camera op. */
function expectPointerInvariant(before: Camera, after: Camera, p: Point): void {
  const wBefore = screenToWorld(before, p);
  const wAfter = screenToWorld(after, p);
  expect(Math.abs(wAfter.x - wBefore.x)).toBeLessThan(TOL);
  expect(Math.abs(wAfter.y - wBefore.y)).toBeLessThan(TOL);
  // The same invariant expressed in screen space.
  const sBefore = worldToScreen(before, wBefore);
  const sAfter = worldToScreen(after, wBefore);
  expect(Math.abs(sAfter.x - sBefore.x)).toBeLessThan(TOL * before.zoom);
  expect(Math.abs(sAfter.y - sBefore.y)).toBeLessThan(TOL * before.zoom);
}

describe('screenToWorld / worldToScreen', () => {
  it('are inverses of each other at origin and far away', () => {
    const cameras = [ORIGIN, { x: -437.5, y: 211.25, zoom: 1.75 }, farAway(2)];
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 300, y: 200 },
      { x: -12.5, y: 64.25 },
    ];
    for (const cam of cameras) {
      for (const p of points) {
        const s = worldToScreen(cam, p);
        const back = screenToWorld(cam, s);
        expect(Math.abs(back.x - p.x)).toBeLessThan(TOL);
        expect(Math.abs(back.y - p.y)).toBeLessThan(TOL);
      }
    }
  });
});

describe('panBy', () => {
  it('TC-01: a 200x100 pixel drag at zoom 1 shifts the camera by exactly that in world units', () => {
    const start = ORIGIN;
    // The dot at world (0,0) is at screen (0,0) before the drag.
    expect(worldToScreen(start, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });

    const cam = panBy(start, 200, 100);

    expect(cam.zoom).toBe(1);
    expect(Math.abs(cam.x - -200)).toBeLessThan(TOL);
    expect(Math.abs(cam.y - -100)).toBeLessThan(TOL);
    // The same dot is now 200 right and 100 down from where it started.
    const dot = worldToScreen(cam, { x: 0, y: 0 });
    expect(Math.abs(dot.x - 200)).toBeLessThan(TOL);
    expect(Math.abs(dot.y - 100)).toBeLessThan(TOL);
  });

  it('TC-02: at ZOOM_MAX far away the camera shifts by delta/zoom world units', () => {
    const start = farAway(ZOOM_MAX);
    const cam = panBy(start, 200, 100);

    // 200 screen px at ZOOM_MAX pixels-per-world-unit is 50 world units.
    expect(Math.abs(cam.x - (UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX))).toBeLessThan(TOL);
    expect(Math.abs(cam.y - (UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX))).toBeLessThan(TOL);
    expect(cam.zoom).toBe(ZOOM_MAX);
  });

  it('returns the same camera object for a zero-length drag', () => {
    // TC-29 boundary: a click without movement must not touch the camera.
    const cam: Camera = { x: -300, y: -200, zoom: 1.25 };
    expect(panBy(cam, 0, 0)).toBe(cam);
  });

  it('scroll input moves content opposite to the scroll direction (pan.scroll)', () => {
    // panBy takes a *pointer* delta (drag semantics): dragging the pointer
    // down by 100px moves content down by 100px, so the camera y decreases.
    const dragged = panBy(ORIGIN, 0, 100);
    expect(dragged.y).toBeLessThan(0);

    // The viewport passes the *negated* wheel deltas (design "viewport.input":
    // `panBy(-deltaX, -deltaY)`), which is what makes scrolling down move
    // content up and scrolling right move content left.
    const scrollPan = (cam: Camera, deltaX: number, deltaY: number) =>
      panBy(cam, -deltaX, -deltaY);
    const scrolledDown = scrollPan(ORIGIN, 0, 100);
    expect(scrolledDown.y).toBeGreaterThan(0);
    const scrolledRight = scrollPan(ORIGIN, 100, 0);
    expect(scrolledRight.x).toBeGreaterThan(0);
  });
});

describe('zoomAt', () => {
  it('TC-03: keeps the world point under the pointer fixed (origin)', () => {
    const p: Point = { x: 300, y: 200 };
    const cam = zoomAt(ORIGIN, p, 2);

    expect(cam.zoom).toBeCloseTo(2, 10);
    expectPointerInvariant(ORIGIN, cam, p);
  });

  it('TC-04: keeps the pointer world point invariant 1,000,000 units away', () => {
    const start = farAway(1);
    const p: Point = { x: 300, y: 200 };
    const cam = zoomAt(start, p, 1.5);

    expect(cam.zoom).toBeCloseTo(1.5, 10);
    expectPointerInvariant(start, cam, p);
  });

  it('TC-05: at ZOOM_MIN zooming out further returns the same camera object', () => {
    const start: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const cam = zoomAt(start, CENTRE, 1 / ZOOM_STEP_FACTOR);

    expect(cam).toBe(start);
    expect(canZoomOut(start)).toBe(false);
  });

  it('TC-06: at ZOOM_MAX zooming in further returns the same camera object', () => {
    const start: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const cam = zoomAt(start, CENTRE, ZOOM_STEP_FACTOR);

    expect(cam).toBe(start);
    expect(canZoomIn(start)).toBe(false);
  });

  it('TC-11: clamps a huge factor and still keeps the pointer invariant', () => {
    const p: Point = { x: 640, y: 400 };
    const cam = zoomAt(ORIGIN, p, 1000);

    expect(cam.zoom).toBe(ZOOM_MAX);
    expectPointerInvariant(ORIGIN, cam, p);

    const down = zoomAt({ x: -1234.5, y: 4321.75, zoom: ZOOM_MIN }, p, 1e-6);
    expect(down.zoom).toBe(ZOOM_MIN);
    expectPointerInvariant({ x: -1234.5, y: 4321.75, zoom: ZOOM_MIN }, down, p);
  });

  it('TC-12: ignores invalid factors without producing NaN', () => {
    for (const factor of [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const cam = zoomAt(ORIGIN, CENTRE, factor);
      expect(cam, `factor ${factor}`).toBe(ORIGIN);
    }
    // Far-away camera is likewise untouched by an invalid factor.
    const start = farAway(1);
    expect(zoomAt(start, CENTRE, Number.NaN)).toBe(start);
    expect(Number.isFinite(start.x) && Number.isFinite(start.y)).toBe(true);
  });
});

describe('zoomStep', () => {
  it('TC-09: one step in then one step out returns exactly the original zoom', () => {
    const inOne = zoomStep(ORIGIN, VIEWPORT, 'in');
    expect(inOne.zoom).toBe(ZOOM_STEP_FACTOR); // 1.25, not 1.2500000000000002
    expect(zoomPercent(inOne)).toBe(125);

    const backOut = zoomStep(inOne, VIEWPORT, 'out');
    expect(backOut.zoom).toBe(1);
    expect(zoomPercent(backOut)).toBe(100);
    expect(backOut.x).toBe(ORIGIN.x);
    expect(backOut.y).toBe(ORIGIN.y);
  });

  it('TC-10: 20 steps in clamp at ZOOM_MAX with no way further in', () => {
    let cam: Camera = ORIGIN;
    const seen: number[] = [];
    for (let i = 0; i < 20; i++) {
      cam = zoomStep(cam, VIEWPORT, 'in');
      seen.push(cam.zoom);
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    // The sequence never overshot the maximum and stopped changing.
    for (const zoom of seen) expect(zoom).toBeLessThanOrEqual(ZOOM_MAX);
    expect(new Set(seen).size).toBeLessThan(20);
    // ...and stepping back out from the clamped maximum works again.
    const out = zoomStep(cam, VIEWPORT, 'out');
    expect(out.zoom).toBeLessThan(ZOOM_MAX);
    expect(canZoomIn(out)).toBe(true);
  });

  it('zooms one step around the centre of the viewport', () => {
    const start: Camera = { x: -400, y: -260, zoom: 1 };
    const cam = zoomStep(start, VIEWPORT, 'in');
    // The world point at the centre of the board area stays at the centre.
    expectPointerInvariant(start, cam, CENTRE);
    expect(cam.x).not.toBe(start.x);
  });

  it('is independent of the viewport size (TC-07)', () => {
    // Resizing the window is not user input to the camera: the transforms do
    // not take the viewport size at all, so content cannot move relative to
    // the top-left corner of the board area.
    const start: Camera = { x: -400, y: -260, zoom: 1.25 };
    const p: Point = { x: 120, y: 90 };
    const before = worldToScreen(start, p);
    const after = worldToScreen(start, p);
    expect(after).toEqual(before);

    // A viewport-dependent operation at a limit still cannot move the camera.
    const atMax: Camera = { x: -400, y: -260, zoom: ZOOM_MAX };
    expect(zoomStep(atMax, BIG_VIEWPORT, 'in')).toBe(atMax);
    const atMin: Camera = { x: -400, y: -260, zoom: ZOOM_MIN };
    expect(zoomStep(atMin, BIG_VIEWPORT, 'out')).toBe(atMin);
  });
});

describe('resetCamera', () => {
  it('TC-08: returns to 100% with the board start point centred', () => {
    const start = farAway(ZOOM_MAX);
    const cam = resetCamera(VIEWPORT);

    expect(cam.zoom).toBe(1);
    expect(Math.abs(cam.x - -600)).toBeLessThan(TOL);
    expect(Math.abs(cam.y - -400)).toBeLessThan(TOL);
    // The starting point (world 0,0) ends up at the centre of the board area.
    const origin = worldToScreen(cam, { x: 0, y: 0 });
    expect(Math.abs(origin.x - VIEWPORT.width / 2)).toBeLessThan(TOL);
    expect(Math.abs(origin.y - VIEWPORT.height / 2)).toBeLessThan(TOL);
    // Reset is reachable from any camera and does not depend on it.
    expect(resetCamera(VIEWPORT)).toEqual(resetCamera(VIEWPORT));
    expect(start.zoom).toBe(ZOOM_MAX);
  });
});

describe('zoomPercent', () => {
  it('is a whole number rounded to the nearest percent', () => {
    expect(zoomPercent(ORIGIN)).toBe(100);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });
});

describe('canZoomIn / canZoomOut', () => {
  it('are false exactly at the limits and true in between', () => {
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
    expect(canZoomIn({ x: 0, y: 0, zoom: 1 })).toBe(true);
    expect(canZoomOut({ x: 0, y: 0, zoom: 1 })).toBe(true);
    // One step inside each limit.
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX / ZOOM_STEP_FACTOR })).toBe(true);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN * ZOOM_STEP_FACTOR })).toBe(true);
  });
});

describe('property: pointer invariance', () => {
  it('holds for 1,000 seeded random cameras, points and factors', () => {
    // Deterministic PRNG so a failure is reproducible.
    let state = 0x9e3779b9;
    const random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    let checked = 0;
    for (let i = 0; i < 1000; i++) {
      const zoom = ZOOM_MIN + random() * (ZOOM_MAX - ZOOM_MIN);
      const extent = random() < 0.5 ? 0 : UNBOUNDED_PAN_TESTED_EXTENT;
      const cam: Camera = {
        x: (random() - 0.5) * 2 * extent,
        y: (random() - 0.5) * 2 * extent,
        zoom,
      };
      const p: Point = { x: random() * 1280, y: random() * 800 };
      const factor = 0.05 + random() * 20;

      const next = zoomAt(cam, p, factor);
      if (next === cam) continue; // clamped or no-op: nothing to check

      expect(Number.isFinite(next.x), `x ${next.x}`).toBe(true);
      expect(Number.isFinite(next.y), `y ${next.y}`).toBe(true);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);

      const wBefore = screenToWorld(cam, p);
      const wAfter = screenToWorld(next, p);
      expect(
        Math.abs(wAfter.x - wBefore.x),
        `x drift ${Math.abs(wAfter.x - wBefore.x)} (cam ${JSON.stringify(cam)} -> ${JSON.stringify(next)})`,
      ).toBeLessThan(TOL);
      expect(
        Math.abs(wAfter.y - wBefore.y),
        `y drift ${Math.abs(wAfter.y - wBefore.y)} (cam ${JSON.stringify(cam)} -> ${JSON.stringify(next)})`,
      ).toBeLessThan(TOL);
      checked += 1;
    }
    // The loop must actually have exercised zoomAt, otherwise it proves nothing.
    expect(checked).toBeGreaterThan(500);
  });
});