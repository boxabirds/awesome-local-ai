import { useCallback, useEffect, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  type Camera,
  type Point,
  type Size,
  panBy,
  resetCamera,
  zoomAt as zoomCameraAt,
  zoomStep as zoomCameraStep,
} from './camera';
import { installTestHooks } from './testHooks';

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  ctrlOrMeta: boolean;
  point: Point;
}

export interface CameraControls {
  camera: Camera;
  hasNavigated: boolean;
  isPanning: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomAt(p: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
}

/**
 * Camera state and navigation actions. The latest camera lives in a ref so that
 * several input events within one frame compose; React state is updated at most
 * once per animation frame.
 */
export function useCamera(viewport: Size): CameraControls {
  const [camera, setCamera] = useState<Camera>(() => resetCamera(viewport));
  const [isPanning, setIsPanning] = useState(false);
  const cameraRef = useRef(camera);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const navigatedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const panPointRef = useRef<Point | null>(null);

  const flush = useCallback(() => {
    frameRef.current = null;
    setCamera(cameraRef.current);
  }, []);

  const apply = useCallback(
    (update: (cam: Camera) => Camera) => {
      const prev = cameraRef.current;
      const next = update(prev);
      if (next === prev) return;
      cameraRef.current = next;
      navigatedRef.current = true;
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

  const beginPan = useCallback((p: Point) => {
    panPointRef.current = p;
    setIsPanning(true);
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = panPointRef.current;
      if (!last) return;
      panPointRef.current = p;
      apply((cam) => panBy(cam, p.x - last.x, p.y - last.y));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    panPointRef.current = null;
    setIsPanning(false);
  }, []);

  const zoomAt = useCallback(
    (p: Point, factor: number) => apply((cam) => zoomCameraAt(cam, p, factor)),
    [apply],
  );

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        apply((cam) => zoomCameraAt(cam, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        apply((cam) => panBy(cam, -e.deltaX, -e.deltaY));
      }
    },
    [apply],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => apply((cam) => zoomCameraStep(cam, viewportRef.current, dir)),
    [apply],
  );

  const reset = useCallback(() => apply(() => resetCamera(viewportRef.current)), [apply]);

  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    return installTestHooks({
      setCamera: (cam) => apply(() => ({ x: cam.x, y: cam.y, zoom: cam.zoom })),
      getCamera: () => cameraRef.current,
    });
  }, [apply]);

  return {
    camera,
    hasNavigated: navigatedRef.current,
    isPanning,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAt,
    zoomStep,
    reset,
  };
}
