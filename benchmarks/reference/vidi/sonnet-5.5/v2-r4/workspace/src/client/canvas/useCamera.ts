import { useCallback, useEffect, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
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
  zoomBy(point: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  /** Jump to an arbitrary camera (used by the test hook). Counts as navigation. */
  setCamera(cam: Camera): void;
}

export function useCamera(viewport: Size): CameraApi {
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const cameraRef = useRef<Camera>(null as unknown as Camera);
  if (cameraRef.current === null) cameraRef.current = resetCamera(viewport);
  const [camera, setCameraState] = useState<Camera>(cameraRef.current);
  const navigatedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const panPointRef = useRef<Point | null>(null);

  // Camera updates are applied synchronously to the ref and flushed to React at most once per frame.
  const commit = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    navigatedRef.current = true;
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        setCameraState(cameraRef.current);
      });
    }
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
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

  const zoomBy = useCallback(
    (point: Point, factor: number) => commit(zoomAt(cameraRef.current, point, factor)),
    [commit],
  );
  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        commit(zoomAt(cameraRef.current, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        commit(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [commit],
  );
  const zoomStep = useCallback(
    (dir: 'in' | 'out') => commit(zoomStepCamera(cameraRef.current, viewportRef.current, dir)),
    [commit],
  );
  const reset = useCallback(() => commit(resetCamera(viewportRef.current)), [commit]);
  const setCamera = useCallback((cam: Camera) => commit(cam), [commit]);

  return {
    camera,
    hasNavigated: navigatedRef.current,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomBy,
    zoomStep,
    reset,
    setCamera,
  };
}
