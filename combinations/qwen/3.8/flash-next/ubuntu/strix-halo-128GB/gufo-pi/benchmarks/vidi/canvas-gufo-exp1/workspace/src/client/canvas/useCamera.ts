/**
 * Camera state plus input handling for the board, as a React hook.
 *
 * The camera is the only view state (nothing is persisted in story 1). Updates go
 * through `camera.ts` and are coalesced to at most one render per animation frame;
 * a no-op update (`camera.ts` returning the same object) neither renders nor
 * dismisses the first-use hint.
 */
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
  type ZoomDirection,
} from './camera';

/** A wheel/trackpad scroll over the board, already converted to CSS pixels. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** Ctrl (Windows/Linux) or Cmd (macOS) held: the gesture zooms instead of panning. */
  readonly ctrlOrMeta: boolean;
  /** Pointer position relative to the board area. */
  readonly point: Point;
}

export interface CameraControls {
  readonly camera: Camera;
  /** True from the first real pan/zoom until the page reloads. */
  readonly hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(input: WheelInput): void;
  /** Zoom by a raw factor around a board point (Safari `gesturechange`). */
  zoomAtPoint(p: Point, factor: number): void;
  zoomStep(direction: ZoomDirection): void;
  reset(): void;
  /** Test-only: jump the camera somewhere (see canvas/testHooks.ts). */
  setCamera(camera: Camera): void;
}

export function useCamera(viewport: Size): CameraControls {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);

  /** Last rendered camera. */
  const renderedRef = useRef<Camera>(camera);
  /** Latest requested camera, waiting for the next frame. */
  const pendingRef = useRef<Camera | null>(null);
  const frameRef = useRef<number | null>(null);
  const hasNavigatedRef = useRef(false);
  const viewportRef = useRef<Size>(viewport);
  const panFromRef = useRef<Point | null>(null);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const flush = useCallback(() => {
    frameRef.current = null;
    const next = pendingRef.current;
    pendingRef.current = null;
    if (!next || next === renderedRef.current) return;
    renderedRef.current = next;
    setCameraState(next);
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
  }, []);

  const current = useCallback(
    (): Camera => pendingRef.current ?? renderedRef.current,
    [],
  );

  const apply = useCallback(
    (next: Camera): void => {
      if (next === current()) return;
      pendingRef.current = next;
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(flush);
      }
    },
    [current, flush],
  );

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      pendingRef.current = null;
    },
    [],
  );

  const beginPan = useCallback((p: Point): void => {
    panFromRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point): void => {
      const from = panFromRef.current;
      if (!from) return;
      panFromRef.current = p;
      apply(panBy(current(), p.x - from.x, p.y - from.y));
    },
    [apply, current],
  );

  const endPan = useCallback((): void => {
    panFromRef.current = null;
  }, []);

  const wheel = useCallback(
    (input: WheelInput): void => {
      if (input.ctrlOrMeta) {
        apply(zoomAt(current(), input.point, Math.exp(-input.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        // Content moves opposite to the scroll direction, like native scrolling.
        apply(panBy(current(), -input.deltaX, -input.deltaY));
      }
    },
    [apply, current],
  );

  const zoomAtPoint = useCallback(
    (p: Point, factor: number): void => {
      apply(zoomAt(current(), p, factor));
    },
    [apply, current],
  );

  const zoomStep = useCallback(
    (direction: ZoomDirection): void => {
      apply(zoomStepCamera(current(), viewportRef.current, direction));
    },
    [apply, current],
  );

  const reset = useCallback((): void => {
    apply(resetCamera(viewportRef.current));
  }, [apply]);

  const setCamera = useCallback(
    (next: Camera): void => {
      apply(next);
    },
    [apply],
  );

  return { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomAtPoint, zoomStep, reset, setCamera };
}
