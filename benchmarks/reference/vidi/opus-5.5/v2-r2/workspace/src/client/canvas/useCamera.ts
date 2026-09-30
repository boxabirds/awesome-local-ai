import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  type Camera,
  type Point,
  type Size,
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as cameraZoomStep,
} from './camera';
import { installTestHooks } from './testHooks';

export interface WheelInput {
  /** Deltas in CSS pixels (deltaMode already converted). */
  deltaX: number;
  deltaY: number;
  ctrlOrMeta: boolean;
  /** Pointer position relative to the board area's top-left. */
  point: Point;
}

export interface CameraController {
  camera: Camera;
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Zoom by an arbitrary factor around a point (Safari pinch gestures). */
  zoomAtPoint(p: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
}

/**
 * Holds the camera for one visit (never persisted). Updates are applied to a
 * ref immediately and flushed to React state at most once per animation frame.
 */
export function useCamera(viewport: Size): CameraController {
  const [camera, setCamera] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);
  const cameraRef = useRef(camera);
  const navigatedRef = useRef(false);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const frameRef = useRef<number | null>(null);
  const panPointRef = useRef<Point | null>(null);

  const flush = useCallback(() => {
    frameRef.current = null;
    setCamera(cameraRef.current);
    setHasNavigated(navigatedRef.current);
  }, []);

  const commit = useCallback(
    (next: Camera, navigated = true) => {
      // Same object means "no change" (limit reached, zero delta, invalid input).
      if (next === cameraRef.current) return;
      cameraRef.current = next;
      if (navigated) navigatedRef.current = true;
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  useEffect(
    () =>
      installTestHooks({
        setCamera: (c) => commit({ x: c.x, y: c.y, zoom: c.zoom }, false),
        getCamera: () => cameraRef.current,
      }),
    [commit],
  );

  const beginPan = useCallback((p: Point) => {
    panPointRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = panPointRef.current;
      if (!last) return;
      panPointRef.current = p;
      commit(panBy(cameraRef.current, p.x - last.x, p.y - last.y));
    },
    [commit],
  );

  const endPan = useCallback(() => {
    panPointRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        commit(zoomAt(cameraRef.current, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        // Scrolling down/right moves the content up/left.
        commit(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [commit],
  );

  const zoomAtPoint = useCallback(
    (p: Point, factor: number) => commit(zoomAt(cameraRef.current, p, factor)),
    [commit],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => commit(cameraZoomStep(cameraRef.current, viewportRef.current, dir)),
    [commit],
  );

  const reset = useCallback(() => commit(resetCamera(viewportRef.current)), [commit]);

  return useMemo(
    () => ({ camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomAtPoint, zoomStep, reset }),
    [camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomAtPoint, zoomStep, reset],
  );
}

export interface BoardCameraContextValue extends CameraController {
  /** Called by BoardViewport when its measured size changes. */
  setViewportSize(size: Size): void;
}

export const BoardCameraContext = createContext<BoardCameraContextValue | null>(null);

export function useBoardCamera(): BoardCameraContextValue {
  const value = useContext(BoardCameraContext);
  if (!value) throw new Error('useBoardCamera must be used inside BoardCameraContext');
  return value;
}
