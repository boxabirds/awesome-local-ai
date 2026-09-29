import { useCallback, useRef, useState } from 'react';
import {
  panBy,
  zoomAt,
  zoomStep as zoomStepMath,
  resetCamera,
  type Camera,
  type Point,
  type Size,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY, WHEEL_LINE_HEIGHT, WHEEL_PAGE_HEIGHT } from '../../shared/config';

/** Interaction mode of the viewport during a gesture. */
export type PanMode = 'idle' | 'panning';

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  ctrlOrMeta: boolean;
  point: Point;
}

export interface CameraApi {
  camera: Camera;
  hasNavigated: boolean;
  mode: PanMode;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomAtPoint(p: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  /** Test-only: replace the camera directly (used by the __vidi6 hook). */
  setCamera(c: Camera): void;
  /** Read the authoritative camera without triggering a render. */
  getCamera(): Camera;
}

/**
 * Owns the camera for a board of the given size. Camera mutations funnel
 * through a single coalescing commit so at most one re-render happens per
 * animation frame; a mutation that would not change the camera (a no-op zoom
 * at a limit, a zero-length drag) never marks the board as navigated, so the
 * first-use hint is not dismissed (TC-29).
 */
export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const [mode, setMode] = useState<PanMode>('idle');
  const [hasNavigated, setHasNavigated] = useState(false);

  const cameraRef = useRef<Camera>(camera);
  const navigatedRef = useRef(false);
  const viewportRef = useRef<Size>(viewport);
  viewportRef.current = viewport;

  const panRef = useRef<{ startX: number; startY: number; start: Camera } | null>(null);

  // Apply a camera synchronously. React batches the state updates that occur
  // inside a single input event (or native listener) into one render, and
  // pointer/wheel events already arrive at roughly one per frame, so this is
  // both deterministic for tests and fluid in the browser. A mutation that
  // returns the same object (a limit no-op, a zero-length drag) never marks
  // the board navigated.
  const commit = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || !Number.isFinite(next.zoom)) return;
    cameraRef.current = next;
    if (!navigatedRef.current) {
      navigatedRef.current = true;
      setHasNavigated(true);
    }
    setCameraState(next);
  }, []);

  const beginPan = useCallback((p: Point) => {
    panRef.current = { startX: p.x, startY: p.y, start: cameraRef.current };
    setMode('panning');
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const pan = panRef.current;
      if (!pan) return;
      const next = panBy(pan.start, p.x - pan.startX, p.y - pan.startY);
      commit(next);
    },
    [commit],
  );

  const endPan = useCallback(() => {
    if (panRef.current) {
      panRef.current = null;
      setMode('idle');
    }
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        commit(zoomAt(cameraRef.current, e.point, factor));
      } else {
        commit(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [commit],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      commit(zoomStepMath(cameraRef.current, viewportRef.current, dir));
    },
    [commit],
  );

  const zoomAtPoint = useCallback(
    (p: Point, factor: number) => {
      commit(zoomAt(cameraRef.current, p, factor));
    },
    [commit],
  );

  const reset = useCallback(() => {
    commit(resetCamera(viewportRef.current));
  }, [commit]);

  const setCamera = useCallback(
    (c: Camera) => {
      // Test hook: apply immediately so callers can assert synchronously.
      commit(c);
    },
    [commit],
  );

  const getCamera = useCallback(() => cameraRef.current, []);

  return {
    camera,
    hasNavigated,
    mode,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAtPoint,
    zoomStep,
    reset,
    setCamera,
    getCamera,
  };
}

/** Convert a wheel delta (any deltaMode) to CSS pixels. */
export function wheelDeltaToPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * WHEEL_LINE_HEIGHT; // DOM_DELTA_LINE
  if (deltaMode === 2) return delta * WHEEL_PAGE_HEIGHT; // DOM_DELTA_PAGE
  return delta;
}