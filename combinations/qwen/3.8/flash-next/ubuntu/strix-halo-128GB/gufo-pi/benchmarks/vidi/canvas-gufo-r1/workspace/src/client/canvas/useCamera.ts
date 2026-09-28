import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type Camera,
  type Point,
  type Size,
  type ZoomDirection,
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as cameraZoomStep,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import { installTestHooks } from './testHooks';

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  ctrlOrMeta: boolean;
  point: Point;
}

export interface CameraController {
  camera: Camera;
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  gesture(point: Point, factor: number): void;
  zoomStep(dir: ZoomDirection): void;
  reset(): void;
}

/**
 * Owns camera state and exposes imperative handlers for every navigation input
 * (drag, wheel, button, keyboard). All mutations funnel through camera.math so
 * limits, pointer-invariance and immutability are guaranteed.
 */
export function useCamera(viewport: Size): CameraController {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);

  const cameraRef = useRef<Camera>(camera);
  const navigatedRef = useRef(false);
  const initializedRef = useRef(false);
  const viewportRef = useRef<Size>(viewport);
  const panRef = useRef<{ x: number; y: number } | null>(null);

  viewportRef.current = viewport;

  // Commit a new camera produced by camera.math. A no-op (same object) never
  // latches `hasNavigated` — this is what keeps the hint up for a click without
  // movement (TC-29) and a zoom already at a limit.
  const applyCamera = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    if (!navigatedRef.current) {
      navigatedRef.current = true;
      setHasNavigated(true);
    }
    setCameraState(next);
  }, []);

  // On first real measurement, centre the starting point (do not count it as
  // navigation — the hint should still be showing).
  useEffect(() => {
    if (initializedRef.current) return;
    if (viewport.width > 0 && viewport.height > 0) {
      initializedRef.current = true;
      const initial = resetCamera(viewport);
      cameraRef.current = initial;
      setCameraState(initial);
    }
  }, [viewport.width, viewport.height]);

  const beginPan = useCallback((p: Point) => {
    panRef.current = { x: p.x, y: p.y };
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = panRef.current;
      if (!last) return;
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      if (dx === 0 && dy === 0) return;
      panRef.current = { x: p.x, y: p.y };
      applyCamera(panBy(cameraRef.current, dx, dy));
    },
    [applyCamera],
  );

  const endPan = useCallback(() => {
    panRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        applyCamera(zoomAt(cameraRef.current, e.point, factor));
      } else {
        applyCamera(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [applyCamera],
  );

  const gesture = useCallback(
    (point: Point, factor: number) => {
      applyCamera(zoomAt(cameraRef.current, point, factor));
    },
    [applyCamera],
  );

  const zoomStep = useCallback(
    (dir: ZoomDirection) => {
      applyCamera(cameraZoomStep(cameraRef.current, viewportRef.current, dir));
    },
    [applyCamera],
  );

  const reset = useCallback(() => {
    applyCamera(resetCamera(viewportRef.current));
  }, [applyCamera]);

  // Test hook (jumps the camera far away in Playwright). No-op in production.
  useEffect(() => {
    return installTestHooks((x, y, zoom) => {
      applyCamera({
        x,
        y,
        zoom: zoom ?? cameraRef.current.zoom,
      });
    });
  }, [applyCamera]);

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    gesture,
    zoomStep,
    reset,
  };
}
