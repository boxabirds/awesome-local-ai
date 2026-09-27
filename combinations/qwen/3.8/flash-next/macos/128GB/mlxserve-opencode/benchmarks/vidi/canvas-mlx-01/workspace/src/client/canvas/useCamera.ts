import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config.js';
import {
  canZoomIn as cameraCanZoomIn,
  canZoomOut as cameraCanZoomOut,
  panBy,
  resetCamera,
  zoomAt,
  zoomPercent,
  zoomStep as zoomStepCamera,
  type Camera,
  type Point,
  type Size,
} from './camera.js';
import { registerTestHooks } from './testHooks.js';

/** A wheel / trackpad scroll, already converted to CSS pixels. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

/** Everything the board chrome needs in order to drive and report the camera. */
export interface CameraApi {
  readonly camera: Camera;
  /** True from the first navigation that actually moved the camera (dismisses the hint). */
  readonly hasNavigated: boolean;
  readonly zoomPercent: number;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Safari pinch: latch the camera and centre that a pinch is measured from. */
  gestureStart(point: Point): void;
  /** Safari pinch: apply the cumulative `gesturechange` scale ratio around a screen point. */
  gesture(point: Point, scale: number): void;
  /** Safari pinch: the fingers left the surface. */
  gestureEnd(): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  setCamera(next: Camera): void;
}

/**
 * Camera state plus every navigation operation. The camera is discarded on reload;
 * nothing is persisted. `hasNavigated` is a ref-backed latch that only flips when a
 * navigation produces a *new* camera object, so a click without movement or a
 * zoom at a limit leaves the hint visible.
 */
export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const cameraRef = useRef<Camera>(camera);
  const viewportRef = useRef<Size>(viewport);
  const hasNavigatedRef = useRef(false);
  const centredRef = useRef(viewport.width > 0 && viewport.height > 0);
  const panStartRef = useRef<{ from: Point; camera: Camera } | null>(null);
  const gestureRef = useRef<{ camera: Camera; point: Point } | null>(null);

  /** Publish a camera; identical cameras are ignored (no render, no hint dismissal). */
  const commit = useCallback((next: Camera): void => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    hasNavigatedRef.current = true;
    setCameraState(next);
  }, []);

  /** Move the camera without counting as user navigation (initial centring only). */
  const recenter = useCallback((next: Camera): void => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    setCameraState(next);
  }, []);

  // Keep the latest viewport. The camera's x/y are viewport-relative, so a resize
  // deliberately leaves the camera untouched: content does not move relative to the
  // top-left corner. The very first real measurement centres the start point.
  useEffect(() => {
    viewportRef.current = viewport;
    if (!centredRef.current && viewport.width > 0 && viewport.height > 0) {
      centredRef.current = true;
      recenter(resetCamera(viewport));
    }
  }, [viewport, recenter]);

  const beginPan = useCallback((p: Point): void => {
    panStartRef.current = { from: { x: p.x, y: p.y }, camera: cameraRef.current };
  }, []);

  /**
   * Safari reports a pinch as a cumulative `scale` measured from the start of the
   * gesture, so `gesturestart` latches the camera and centre that the following
   * `gesturechange` values are applied to.
   */
  const gestureStart = useCallback((p: Point): void => {
    gestureRef.current = { camera: cameraRef.current, point: p };
  }, []);

  const panMove = useCallback(
    (p: Point): void => {
      const drag = panStartRef.current;
      if (!drag) return;
      commit(panBy(drag.camera, p.x - drag.from.x, p.y - drag.from.y));
    },
    [commit],
  );

  const endPan = useCallback((): void => {
    panStartRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput): void => {
      if (e.ctrlOrMeta) {
        commit(zoomAt(cameraRef.current, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
        return;
      }
      commit(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
    },
    [commit],
  );

  const gesture = useCallback(
    (point: Point, scale: number): void => {
      const anchor = gestureRef.current ?? { camera: cameraRef.current, point };
      commit(zoomAt(anchor.camera, anchor.point, scale));
    },
    [commit],
  );

  const gestureEnd = useCallback((): void => {
    gestureRef.current = null;
  }, []);

  const zoomStep = useCallback(
    (dir: 'in' | 'out'): void => {
      commit(zoomStepCamera(cameraRef.current, viewportRef.current, dir));
    },
    [commit],
  );

  const reset = useCallback((): void => {
    commit(resetCamera(viewportRef.current));
  }, []);

  const setCamera = useCallback(
    (next: Camera): void => {
      commit(next);
    },
    [commit],
  );

  // Test-only camera jump (used by the Playwright suite to travel far away).
  const getCamera = useCallback((): Camera => cameraRef.current, []);
  useEffect(() => {
    registerTestHooks(setCamera, getCamera);
  }, [setCamera, getCamera]);

  return useMemo<CameraApi>(
    () => ({
      camera: camera,
      hasNavigated: hasNavigatedRef.current,
      zoomPercent: zoomPercent(camera),
      canZoomIn: cameraCanZoomIn(camera),
      canZoomOut: cameraCanZoomOut(camera),
      beginPan,
      panMove,
      endPan,
      wheel,
      gestureStart,
      gesture,
      gestureEnd,
      zoomStep,
      reset,
      setCamera,
    }),
    [camera, beginPan, panMove, endPan, wheel, gestureStart, gesture, gestureEnd, zoomStep, reset, setCamera],
  );
}

/**
 * Viewport size of a fixed, full-window element. Defaults to `window` so the board
 * area (position: fixed; inset: 0) always matches the browser viewport.
 */
export function useViewportSize(target?: HTMLElement): Size {
  const [size, setSize] = useState<Size>(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }));

  useEffect(() => {
    const node: HTMLElement | null = target ?? (document.getElementById('root') ?? null);
    const measure = (): void => {
      const rect = node ? node.getBoundingClientRect() : null;
      const width = rect && rect.width > 0 ? rect.width : window.innerWidth;
      const height = rect && rect.height > 0 ? rect.height : window.innerHeight;
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    if (node) observer.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [target]);

  return size;
}
