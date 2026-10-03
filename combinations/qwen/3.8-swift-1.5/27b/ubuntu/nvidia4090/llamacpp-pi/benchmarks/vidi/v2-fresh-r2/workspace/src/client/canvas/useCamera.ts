import { useCallback, useEffect, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import { panBy, resetCamera, zoomAt, zoomStep as stepZoom } from './camera';
import type { Camera, Point, Size } from './camera';
import { registerTestHooks, unregisterTestHooks } from './testHooks';

/** Normalised wheel input for {@link CameraControls.wheel}. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  ctrlOrMeta: boolean;
  point: Point;
}

/**
 * The camera state and input handlers, shared by the board viewport, the zoom
 * controls and the navigation hint.
 */
export interface CameraControls {
  camera: Camera;
  /** Latches true on the first camera change; never resets during the visit. */
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
}

/**
 * React hook: camera state plus input handlers.
 *
 * Camera updates are coalesced with requestAnimationFrame to at most one
 * render per frame. The `hasNavigated` latch flips only when the camera
 * maths returns a *new* object, so no-op updates (click without movement,
 * zoom at a limit) never dismiss the navigation hint.
 */
export function useCamera(viewport: Size): CameraControls {
  const [camera, setCamera] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);

  const cameraRef = useRef(camera);
  const viewportRef = useRef(viewport);
  const lastPointerRef = useRef<Point | null>(null);
  const rafRef = useRef<number | null>(null);

  viewportRef.current = viewport;

  const apply = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setCamera(cameraRef.current);
        setHasNavigated(true);
      });
    }
  }, []);

  const beginPan = useCallback((p: Point) => {
    lastPointerRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = lastPointerRef.current;
      if (last === null) return;
      lastPointerRef.current = p;
      apply(panBy(cameraRef.current, p.x - last.x, p.y - last.y));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    lastPointerRef.current = null;
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
      apply(stepZoom(cameraRef.current, viewportRef.current, dir));
    },
    [apply],
  );

  const reset = useCallback(() => {
    apply(resetCamera(viewportRef.current));
  }, [apply]);

  // Test hook (test builds only): jump the camera directly, e.g. far away.
  const setCameraDirect = useCallback((next: Camera) => {
    cameraRef.current = next;
    setCamera(next);
    setHasNavigated(true);
  }, []);

  useEffect(() => {
    registerTestHooks(setCameraDirect);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      unregisterTestHooks();
    };
  }, [setCameraDirect]);

  return { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset };
}
