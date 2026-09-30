import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt as zoomAtCamera,
  zoomStep as zoomStepCamera,
  type Camera,
  type Point,
  type Size,
} from './camera';

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  ctrlOrMeta: boolean;
  point: Point;
}

export interface CameraApi {
  camera: Camera;
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Zoom by an arbitrary factor around a screen point (Safari gesture scale ratio). */
  zoomAt(p: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  /** Jump straight to a camera (test hook only). */
  setCamera(cam: Camera): void;
}

/**
 * Camera state for one board view. The latest camera is kept in a ref so
 * rapid inputs (pointermove, wheel) compose synchronously, while React state
 * is flushed at most once per animation frame.
 */
export function useCamera(viewport: Size): CameraApi {
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const cameraRef = useRef(camera);
  const navigatedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const panLastRef = useRef<Point | null>(null);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const update = useCallback((fn: (cam: Camera) => Camera) => {
    const prev = cameraRef.current;
    const next = fn(prev);
    if (next === prev) return;
    cameraRef.current = next;
    navigatedRef.current = true;
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        setCameraState(cameraRef.current);
      });
    }
  }, []);

  const beginPan = useCallback((p: Point) => {
    panLastRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = panLastRef.current;
      if (!last) return;
      panLastRef.current = p;
      update((cam) => panBy(cam, p.x - last.x, p.y - last.y));
    },
    [update],
  );

  const endPan = useCallback(() => {
    panLastRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        update((cam) => zoomAtCamera(cam, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        update((cam) => panBy(cam, -e.deltaX, -e.deltaY));
      }
    },
    [update],
  );

  const zoomAt = useCallback(
    (p: Point, factor: number) => update((cam) => zoomAtCamera(cam, p, factor)),
    [update],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => update((cam) => zoomStepCamera(cam, viewportRef.current, dir)),
    [update],
  );

  const reset = useCallback(() => {
    update((cam) => {
      const next = resetCamera(viewportRef.current);
      return next.x === cam.x && next.y === cam.y && next.zoom === cam.zoom ? cam : next;
    });
  }, [update]);

  const setCamera = useCallback((cam: Camera) => update(() => ({ ...cam })), [update]);

  const hasNavigated = navigatedRef.current;
  return useMemo(
    () => ({ camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomAt, zoomStep, reset, setCamera }),
    [camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomAt, zoomStep, reset, setCamera],
  );
}

export interface CameraContextValue {
  api: CameraApi;
  onViewportResize(size: Size): void;
}

export const CameraContext = createContext<CameraContextValue | null>(null);

export function useCameraContext(): CameraContextValue {
  const ctx = useContext(CameraContext);
  if (!ctx) throw new Error('useCameraContext must be used inside CameraContext');
  return ctx;
}
