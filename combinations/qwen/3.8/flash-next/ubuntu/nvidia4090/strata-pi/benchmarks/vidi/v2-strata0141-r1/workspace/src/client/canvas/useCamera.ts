import { useCallback, useEffect, useRef, useState } from 'react';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep,
  type Camera,
  type Point,
  type Size,
  type ZoomDirection,
} from './camera';
import { WHEEL_LINE_PX, WHEEL_PAGE_PX, WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import { registerCameraApi } from '../testHooks';

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

export interface CameraApi {
  readonly camera: Camera;
  readonly viewport: Size;
  readonly hasNavigated: boolean;
  readonly isPanning: boolean;
  beginPan(point: Point): void;
  panMove(point: Point): void;
  endPan(): void;
  wheel(input: WheelInput): void;
  zoomAtPointer(point: Point, factor: number): void;
  zoomStep(direction: ZoomDirection): void;
  reset(): void;
}

/** Convert a wheel delta in lines/pages to CSS pixels. */
export function wheelDeltaToPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) {
    return delta * WHEEL_LINE_PX;
  }
  if (deltaMode === 2) {
    return delta * WHEEL_PAGE_PX;
  }
  return delta;
}

/** Zoom factor for a wheel/pinch delta. */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY);
}

/**
 * Camera state plus the navigation actions. All camera mutations go through
 * camera.math; a mutation that returns the same object is a no-op (it does not
 * re-render and does not count as navigation).
 */
export function useCamera(viewport: Size): CameraApi {
  const [camera, setCamera] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const cameraRef = useRef<Camera>(camera);
  const viewportRef = useRef<Size>(viewport);
  const navigatedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const panFromRef = useRef<Point | null>(null);

  viewportRef.current = viewport;

  const flush = useCallback(() => {
    frameRef.current = null;
    setCamera(cameraRef.current);
  }, []);

  const apply = useCallback(
    (next: Camera) => {
      if (next === cameraRef.current) {
        return;
      }
      cameraRef.current = next;
      if (!navigatedRef.current) {
        navigatedRef.current = true;
        setHasNavigated(true);
      }
      // Coalesce rapid input (pointermove, wheel) to at most one render per frame.
      if (frameRef.current === null) {
        if (typeof requestAnimationFrame === 'function') {
          frameRef.current = requestAnimationFrame(flush);
        } else {
          flush();
        }
      }
    },
    [flush],
  );

  const beginPan = useCallback((point: Point) => {
    panFromRef.current = point;
    setIsPanning(true);
  }, []);

  const panMove = useCallback(
    (point: Point) => {
      const from = panFromRef.current;
      if (from === null) {
        return;
      }
      panFromRef.current = point;
      apply(panBy(cameraRef.current, point.x - from.x, point.y - from.y));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    panFromRef.current = null;
    setIsPanning(false);
  }, []);

  const wheel = useCallback(
    (input: WheelInput) => {
      if (input.ctrlOrMeta) {
        apply(zoomAt(cameraRef.current, input.point, wheelZoomFactor(input.deltaY)));
        return;
      }
      apply(panBy(cameraRef.current, -input.deltaX, -input.deltaY));
    },
    [apply],
  );

  const zoomAtPointer = useCallback(
    (point: Point, factor: number) => {
      apply(zoomAt(cameraRef.current, point, factor));
    },
    [apply],
  );

  const stepZoom = useCallback(
    (direction: ZoomDirection) => {
      apply(zoomStep(cameraRef.current, viewportRef.current, direction));
    },
    [apply],
  );

  const reset = useCallback(() => {
    apply(resetCamera(viewportRef.current));
  }, [apply]);

  // Test-only hook so e2e can jump far away instead of dragging a million pixels.
  useEffect(() => {
    registerCameraApi({
      set: (next: Camera) => {
        cameraRef.current = next;
        setCamera(next);
      },
      get: () => cameraRef.current,
    });
    return () => registerCameraApi(null);
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return {
    camera,
    viewport,
    hasNavigated,
    isPanning,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAtPointer,
    zoomStep: stepZoom,
    reset,
  };
}
