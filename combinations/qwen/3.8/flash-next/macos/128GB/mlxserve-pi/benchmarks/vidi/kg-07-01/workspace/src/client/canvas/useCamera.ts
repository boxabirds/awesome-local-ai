import { useCallback, useEffect, useRef, useState } from 'react';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepCamera,
  type Camera,
  type Point,
  type Size,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

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
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  /** Multiply zoom by `factor` around `point` (Safari gesture events). */
  zoomBy(point: Point, factor: number): void;
  /** Replace the camera without counting as navigation (test hook only). */
  setCamera(cam: Camera): void;
}

/**
 * Camera state plus input handlers. The camera ref is the source of truth;
 * continuous input (drag, wheel, gesture) is rendered at most once per animation frame,
 * discrete actions (buttons, keys, reset) render immediately.
 */
export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);
  const cameraRef = useRef(camera);
  const navigatedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const panLastRef = useRef<Point | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const flush = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setCameraState(cameraRef.current);
  }, []);

  const apply = useCallback(
    (next: Camera, immediate: boolean) => {
      if (next === cameraRef.current) return;
      cameraRef.current = next;
      if (!navigatedRef.current) {
        navigatedRef.current = true;
        setHasNavigated(true);
      }
      if (immediate) {
        flush();
      } else if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          setCameraState(cameraRef.current);
        });
      }
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const beginPan = useCallback((p: Point) => {
    panLastRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = panLastRef.current;
      if (!last) return;
      panLastRef.current = p;
      apply(panBy(cameraRef.current, p.x - last.x, p.y - last.y), false);
    },
    [apply],
  );

  const endPan = useCallback(() => {
    panLastRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      const cam = cameraRef.current;
      if (e.ctrlOrMeta) {
        apply(zoomAt(cam, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)), false);
      } else {
        // Content moves opposite to the scroll direction, like native scrolling.
        apply(panBy(cam, -e.deltaX, -e.deltaY), false);
      }
    },
    [apply],
  );

  const zoomBy = useCallback(
    (point: Point, factor: number) => apply(zoomAt(cameraRef.current, point, factor), false),
    [apply],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => apply(zoomStepCamera(cameraRef.current, viewportRef.current, dir), true),
    [apply],
  );

  const reset = useCallback(() => apply(resetCamera(viewportRef.current), true), [apply]);

  const setCamera = useCallback(
    (cam: Camera) => {
      cameraRef.current = cam;
      flush();
    },
    [flush],
  );

  return { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset, zoomBy, setCamera };
}
