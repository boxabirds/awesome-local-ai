import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { WHEEL_ZOOM_MAX_EXPONENT, WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepAtCentre,
  type Camera,
  type Point,
  type Size,
} from './camera';

export interface WheelInput {
  /** Scroll delta in CSS pixels (already converted from lines/pages). */
  readonly deltaX: number;
  readonly deltaY: number;
  /** True when Ctrl (or Cmd on macOS) is held: the gesture zooms instead of pans. */
  readonly ctrlOrMeta: boolean;
  /** Pointer position relative to the top-left of the board area. */
  readonly point: Point;
}

export interface CameraApi {
  /** The camera that is currently rendered. */
  readonly camera: Camera;
  /** Latches to true on the first camera change of this visit; never resets. */
  readonly hasNavigated: boolean;
  beginPan(point: Point): void;
  panMove(point: Point): void;
  endPan(): void;
  wheel(input: WheelInput): void;
  /** Pinch gesture: multiply the zoom by `factor` around `point`. */
  pinch(factor: number, point: Point): void;
  zoomStep(direction: 'in' | 'out'): void;
  reset(): void;
  /** Used by the e2e test hook to jump the camera. */
  setCamera(camera: Camera): void;
}

/**
 * Owns the camera for one board. The camera lives only in React state: nothing
 * is persisted, so a reload returns to the standard view (story 1 scope).
 *
 * A viewport resize never moves the camera: `x, y` is the world coordinate at
 * the top-left of the board area, so content stays anchored there.
 */
export function useCamera(viewport: Size): CameraApi {
  // Latest viewport size without re-creating the camera.
  const viewportRef = useRef<Size>(viewport);
  viewportRef.current = viewport;

  const cameraRef = useRef<Camera | null>(null);
  if (cameraRef.current === null) cameraRef.current = resetCamera(viewport);
  const [camera, setCameraState] = useState<Camera>(cameraRef.current);

  const hasNavigatedRef = useRef(false);
  const [hasNavigated, setHasNavigated] = useState(false);

  const frameRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const lastPointRef = useRef<Point>({ x: 0, y: 0 });

  /**
   * Commit a camera produced by camera.math. No-ops (same values, which is what
   * camera.math returns at a limit or for a zero-length drag) are dropped, so
   * they neither re-render nor dismiss the navigation hint. Updates arriving
   * faster than the display refreshes are coalesced into one render per frame.
   */
  const apply = useCallback((next: Camera): void => {
    const current = cameraRef.current;
    if (current === null) {
      cameraRef.current = next;
      setCameraState(next);
      return;
    }
    if (next === current || (next.x === current.x && next.y === current.y && next.zoom === current.zoom)) {
      return;
    }
    cameraRef.current = next;
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const latest = cameraRef.current;
        if (latest !== null) setCameraState(latest);
      });
    }
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    },
    [],
  );

  const beginPan = useCallback((point: Point): void => {
    draggingRef.current = true;
    lastPointRef.current = point;
  }, []);

  const panMove = useCallback(
    (point: Point): void => {
      if (!draggingRef.current) return;
      const last = lastPointRef.current;
      lastPointRef.current = point;
      apply(panBy(cameraRef.current as Camera, point.x - last.x, point.y - last.y));
    },
    [apply],
  );

  const endPan = useCallback((): void => {
    draggingRef.current = false;
  }, []);

  const wheel = useCallback(
    (input: WheelInput): void => {
      if (input.ctrlOrMeta) {
        // Trackpad pinch and Ctrl + wheel: zoom around the pointer. The factor
        // is always > 0, so an out-of-range deltaY simply clamps at a limit.
        const exponent = clampFinite(
          -input.deltaY * WHEEL_ZOOM_SENSITIVITY,
          -WHEEL_ZOOM_MAX_EXPONENT,
          WHEEL_ZOOM_MAX_EXPONENT,
        );
        apply(zoomAt(cameraRef.current as Camera, input.point, Math.exp(exponent)));
        return;
      }
      // Plain scroll: content moves opposite to the scroll direction, the way
      // native scrolling moves content.
      apply(panBy(cameraRef.current as Camera, -input.deltaX, -input.deltaY));
    },
    [apply],
  );

  const pinch = useCallback(
    (factor: number, point: Point): void => {
      apply(zoomAt(cameraRef.current as Camera, point, factor));
    },
    [apply],
  );

  const zoomStep = useCallback(
    (direction: 'in' | 'out'): void => {
      apply(zoomStepAtCentre(cameraRef.current as Camera, viewportRef.current, direction));
    },
    [apply],
  );

  const reset = useCallback((): void => {
    apply(resetCamera(viewportRef.current));
  }, [apply]);

  const setCamera = useCallback(
    (next: Camera): void => {
      apply(next);
    },
    [apply],
  );

  return { camera, hasNavigated, beginPan, panMove, endPan, wheel, pinch, zoomStep, reset, setCamera };
}

function clampFinite(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.min(max, Math.max(min, value));
}

export const CameraContext = createContext<CameraApi | null>(null);

/** The camera of the board this component is rendered inside. */
export function useCameraContext(): CameraApi {
  const api = useContext(CameraContext);
  if (api === null) {
    throw new Error('useCameraContext must be used inside a <CameraContext.Provider>');
  }
  return api;
}
