import { useCallback, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as cameraZoomStep,
  type Camera,
  type Point,
  type Size,
} from './camera';

export type { Camera, Point, Size };

/** A wheel/trackpad scroll over the board, already in CSS pixels. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** Ctrl or Cmd held: the scroll is a zoom gesture, not a pan. */
  readonly ctrlOrMeta: boolean;
  /** Pointer position in viewport coordinates, the point to zoom around. */
  readonly point: Point;
}

export interface BoardCamera {
  camera: Camera;
  /** Latches true the first time the camera actually changes this visit. */
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Pinch/trackpad zoom: multiply the zoom by `factor` around `point`. */
  zoomBy(factor: number, point: Point): void;
  zoomStep(direction: 'in' | 'out'): void;
  reset(): void;
  /** Move the camera to an absolute position (used by the test hook). */
  setCamera(cam: Camera): void;
  /** Apply any camera change held back for the next frame, right now. */
  flush(): void;
}

/**
 * Camera state plus the navigation operations the board exposes.
 *
 * Camera updates are coalesced to at most one render per animation frame:
 * `cameraRef` always holds the newest camera, and a `requestAnimationFrame`
 * callback publishes it to React. `flush()` publishes immediately (used when
 * a gesture ends, and by tests).
 */
export function useCamera(viewport: Size): BoardCamera {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const cameraRef = useRef<Camera>(camera);
  const [hasNavigated, setHasNavigated] = useState(false);
  const hasNavigatedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const viewportRef = useRef<Size>(viewport);
  viewportRef.current = viewport;

  const flush = useCallback(() => {
    if (frameRef.current === null) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    setCameraState(cameraRef.current);
  }, []);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setCameraState(cameraRef.current);
    });
  }, []);

  /** Take a new camera from camera.math; ignore no-ops (same object). */
  const commit = useCallback(
    (next: Camera) => {
      if (next === cameraRef.current) return;
      cameraRef.current = next;
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        setHasNavigated(true);
      }
      schedule();
    },
    [schedule],
  );

  const dragRef = useRef<{ readonly pointer: Point; readonly camera: Camera } | null>(null);

  const beginPan = useCallback((p: Point) => {
    // Remember where the drag started so the board tracks the pointer exactly
    // instead of accumulating rounding from per-event deltas.
    dragRef.current = { pointer: p, camera: cameraRef.current };
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const drag = dragRef.current;
      if (!drag) return;
      commit(panBy(drag.camera, p.x - drag.pointer.x, p.y - drag.pointer.y));
    },
    [commit],
  );

  const endPan = useCallback(() => {
    dragRef.current = null;
    flush();
  }, [flush]);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        commit(zoomAt(cameraRef.current, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
        return;
      }
      // Content moves opposite to the scroll, like native scrolling.
      commit(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
    },
    [commit],
  );

  const zoomBy = useCallback(
    (factor: number, point: Point) => {
      commit(zoomAt(cameraRef.current, point, factor));
    },
    [commit],
  );

  const zoomStep = useCallback(
    (direction: 'in' | 'out') => {
      commit(cameraZoomStep(cameraRef.current, viewportRef.current, direction));
    },
    [commit],
  );

  const reset = useCallback(() => {
    commit(resetCamera(viewportRef.current));
  }, [commit]);

  const setCamera = useCallback(
    (cam: Camera) => {
      commit(cam);
      flush();
    },
    [commit, flush],
  );

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomBy,
    zoomStep,
    reset,
    setCamera,
    flush,
  };
}
