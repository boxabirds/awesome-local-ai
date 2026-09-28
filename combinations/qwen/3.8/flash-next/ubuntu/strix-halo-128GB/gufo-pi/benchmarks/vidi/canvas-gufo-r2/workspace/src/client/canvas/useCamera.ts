import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepCamera,
  type Camera,
  type Point,
  type Size,
  type ZoomDirection,
} from './camera';

export interface WheelInput {
  /** Horizontal scroll delta in CSS pixels. */
  deltaX: number;
  /** Vertical scroll delta in CSS pixels. */
  deltaY: number;
  /** True when Ctrl (or Cmd on macOS) is held: the wheel zooms instead of pans. */
  ctrlOrMeta: boolean;
  /** Pointer position relative to the board area, in CSS pixels. */
  point: Point;
}

export interface ZoomGestureInput {
  /** Multiplicative scale relative to the previous gesture event. */
  scale: number;
  point: Point;
}

export interface CameraController {
  camera: Camera;
  /** Latches true on the first camera change that actually changed the camera. */
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(input: WheelInput): void;
  /** Safari trackpad pinch (`gesturechange`). */
  zoomGesture(input: ZoomGestureInput): void;
  zoomStep(direction: ZoomDirection): void;
  reset(): void;
  /** Used by the test-only `window.__vidi6.setCamera` hook. */
  setCamera(camera: Camera): void;
}

/**
 * Holds the camera and turns input into camera changes.
 *
 * Updates go through `apply`, which (a) ignores no-ops — camera.math returns the
 * same object when nothing changes — so the navigation hint is not dismissed by a
 * click without movement or a zoom at a limit, and (b) coalesces writes to at most
 * one React render per animation frame.
 */
export function useCamera(viewport: Size): CameraController {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);

  const cameraRef = useRef<Camera>(camera);
  const hasNavigatedRef = useRef(false);
  const initialisedRef = useRef(viewport.width > 0 && viewport.height > 0);
  const panFromRef = useRef<Point | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ camera: Camera; navigation: boolean } | null>(null);

  const flush = useCallback(() => {
    frameRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    setCameraState(pending.camera);
    if (pending.navigation && !hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
  }, []);

  const apply = useCallback(
    (next: Camera, navigation = true) => {
      if (next === cameraRef.current) return;
      cameraRef.current = next;
      const previous = pendingRef.current;
      pendingRef.current = {
        camera: next,
        navigation: (previous?.navigation ?? false) || navigation,
      };
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(flush);
      }
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      pendingRef.current = null;
    },
    [],
  );

  // The first real measurement of the board area establishes the standard view
  // (origin centred at 100%). Later resizes deliberately do nothing: the camera
  // is defined by its top-left corner, so content never shifts on resize.
  useEffect(() => {
    if (initialisedRef.current) return;
    if (viewport.width <= 0 || viewport.height <= 0) return;
    initialisedRef.current = true;
    apply(resetCamera(viewport), false);
  }, [apply, viewport]);

  const beginPan = useCallback((p: Point) => {
    panFromRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const from = panFromRef.current;
      if (!from) return;
      panFromRef.current = p;
      apply(panBy(cameraRef.current, p.x - from.x, p.y - from.y));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    panFromRef.current = null;
  }, []);

  const wheel = useCallback(
    ({ deltaX, deltaY, ctrlOrMeta, point }: WheelInput) => {
      if (ctrlOrMeta) {
        apply(zoomAt(cameraRef.current, point, Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        apply(panBy(cameraRef.current, -deltaX, -deltaY));
      }
    },
    [apply],
  );

  const zoomGesture = useCallback(
    ({ scale, point }: ZoomGestureInput) => {
      if (!Number.isFinite(scale) || scale <= 0) return;
      apply(zoomAt(cameraRef.current, point, scale));
    },
    [apply],
  );

  const zoomStep = useCallback(
    (direction: ZoomDirection) => {
      apply(zoomStepCamera(cameraRef.current, viewport, direction));
    },
    [apply, viewport],
  );

  const reset = useCallback(() => {
    apply(resetCamera(viewport));
  }, [apply, viewport]);

  const setCamera = useCallback(
    (next: Camera) => {
      apply(next);
    },
    [apply],
  );

  return useMemo<CameraController>(
    () => ({
      camera,
      hasNavigated,
      beginPan,
      panMove,
      endPan,
      wheel,
      zoomGesture,
      zoomStep,
      reset,
      setCamera,
    }),
    [camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomGesture, zoomStep, reset, setCamera],
  );
}
