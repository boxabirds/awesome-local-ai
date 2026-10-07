import { useCallback, useEffect, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  zoomAt,
  resetCamera,
  zoomStep as zoomStepCamera,
  type Camera,
  type Point,
  type Size,
  type ZoomDirection,
} from './camera';
import { patchTestHook, unpatchTestHook } from './testHooks';

/** Normalised wheel/pinch input already converted to CSS pixels. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

export interface UseCamera {
  readonly camera: Camera;
  readonly hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomAtPoint(p: Point, factor: number): void;
  zoomStep(dir: ZoomDirection): void;
  reset(): void;
}

/**
 * Camera state + input handlers. Pure of DOM event types: callers translate
 * raw pointer/wheel/gesture/keyboard events into screen-space points & deltas.
 *
 * Camera commits are coalesced to at most one render per animation frame; the
 * live value is tracked in a ref so rapid pointer moves accumulate correctly.
 */
export function useCamera(viewport: Size): UseCamera {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);

  const renderedRef = useRef<Camera>(camera); // last camera handed to React
  const liveRef = useRef<Camera>(camera); // newest logical camera
  const navigatedRef = useRef(false); // one-way latch for the hint
  const frameRef = useRef<number | null>(null);
  const panActiveRef = useRef(false);
  const lastPanRef = useRef<Point | null>(null);

  const scheduleRender = useCallback(() => {
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const next = liveRef.current;
      if (next !== renderedRef.current) {
        renderedRef.current = next;
        setCameraState(next);
      }
    });
  }, []);

  // Apply a new camera; a no-op (same object) neither renders nor trips the hint.
  const apply = useCallback(
    (next: Camera) => {
      if (next === liveRef.current) return;
      liveRef.current = next;
      if (!navigatedRef.current) {
        navigatedRef.current = true;
        setHasNavigated(true);
      }
      scheduleRender();
    },
    [scheduleRender],
  );

  const beginPan = useCallback((p: Point) => {
    panActiveRef.current = true;
    lastPanRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      if (!panActiveRef.current) return;
      const last = lastPanRef.current;
      if (!last) return;
      lastPanRef.current = p;
      apply(panBy(liveRef.current, p.x - last.x, p.y - last.y));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    panActiveRef.current = false;
    lastPanRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        apply(zoomAt(liveRef.current, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        apply(panBy(liveRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [apply],
  );

  const zoomAtPoint = useCallback(
    (p: Point, factor: number) => apply(zoomAt(liveRef.current, p, factor)),
    [apply],
  );

  const zoomStep = useCallback(
    (dir: ZoomDirection) => apply(zoomStepCamera(liveRef.current, viewport, dir)),
    [apply, viewport],
  );

  const reset = useCallback(() => apply(resetCamera(viewport)), [apply, viewport]);

  // Cancel any pending frame on unmount.
  useEffect(
    () => () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  // Test-only hook (excluded from production builds by MODE check).
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    patchTestHook({
      getCamera: () => liveRef.current,
      setCamera: (c: Camera) => {
        liveRef.current = c;
        if (!navigatedRef.current) {
          navigatedRef.current = true;
          setHasNavigated(true);
        }
        renderedRef.current = c;
        setCameraState(c);
      },
    });
    return () => unpatchTestHook(['getCamera', 'setCamera']);
  }, []);

  return { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomAtPoint, zoomStep, reset };
}
