import { useCallback, useRef, useState } from 'react';
import {
  type Camera,
  type Point,
  type Size,
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepCam,
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
  setCameraDirect(cam: Camera): void;
}

/**
 * Camera state + input handlers. The `hasNavigated` latch trips on the first
 * camera change that produces a different camera object; a no-op update
 * (same object) does not trip it.
 */
export function useCamera(viewport: Size): CameraApi {
  const [camera, setCamera] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);
  const cameraRef = useRef(camera);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const panRef = useRef<{ point: Point; camera: Camera } | null>(null);

  const apply = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    setCamera(next);
    setHasNavigated(true);
  }, []);

  const beginPan = useCallback((p: Point) => {
    panRef.current = { point: p, camera: cameraRef.current };
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const start = panRef.current;
      if (!start) return;
      apply(panBy(start.camera, p.x - start.point.x, p.y - start.point.y));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    panRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        apply(zoomAt(cameraRef.current, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        apply(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [apply],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      apply(zoomStepCam(cameraRef.current, viewportRef.current, dir));
    },
    [apply],
  );

  const reset = useCallback(() => {
    apply(resetCamera(viewportRef.current));
  }, [apply]);

  const setCameraDirect = useCallback(
    (cam: Camera) => {
      cameraRef.current = cam;
      setCamera(cam);
      setHasNavigated(true);
    },
    [],
  );

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomStep,
    reset,
    setCameraDirect,
  };
}
