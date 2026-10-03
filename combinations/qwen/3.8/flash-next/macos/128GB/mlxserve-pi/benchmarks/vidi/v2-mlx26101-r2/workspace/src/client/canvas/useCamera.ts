import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config.js';
import {
  canZoomIn as canZoomInCamera,
  canZoomOut as canZoomOutCamera,
  panBy,
  resetCamera,
  zoomAt,
  zoomPercent as zoomPercentCamera,
  zoomStep as zoomStepCamera,
  type Camera,
  type Point,
  type Size,
} from './camera.js';
import { clearTestHooks, registerTestHooks } from './testHooks.js';

/**
 * WheelEvent.DOM_DELTA_LINE: one wheel tick moves one line of this many CSS
 * pixels (Firefox reports line deltas for a mouse wheel).
 */
export const WHEEL_LINE_PIXELS = 16;
/** The key that resets the view when combined with Ctrl/Cmd. */
export const RESET_KEYS = ['0'];
/** Keys that zoom one step when combined with Ctrl/Cmd. */
export const ZOOM_IN_KEYS = ['=', '+'];
export const ZOOM_OUT_KEYS = ['-', '_'];

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** WheelEvent.deltaMode: 0 pixels, 1 lines, 2 pages. */
  readonly deltaMode?: number;
  readonly ctrlOrMeta: boolean;
  /** Pointer position in board-area (screen) coordinates. */
  readonly point: Point;
}

export interface UseCameraResult {
  camera: Camera;
  /** Latches true on the first camera change of the visit and never resets. */
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Safari trackpad pinch (GestureEvent). */
  gestureStart(p: Point): void;
  gestureChange(p: Point, scale: number): void;
  gestureEnd(): void;
  zoomStep(direction: 'in' | 'out'): void;
  reset(): void;
}

/** Convert a wheel delta in lines/pages into CSS pixels. */
export function wheelDeltaToPixels(delta: number, deltaMode: number | undefined, viewport: Size): number {
  switch (deltaMode) {
    case 1: // DOM_DELTA_LINE
      return delta * WHEEL_LINE_PIXELS;
    case 2: // DOM_DELTA_PAGE
      return delta * Math.max(viewport.width, viewport.height);
    default:
      return delta;
  }
}

const sameCamera = (a: Camera, b: Camera): boolean => a.x === b.x && a.y === b.y && a.zoom === b.zoom;

/** Zoom factor for a wheel/pinch delta (design: exp(-deltaY * sensitivity)). */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY);
}

/**
 * Camera state plus every navigation input handler (design "viewport.input").
 * All geometry is delegated to the pure functions in camera.ts.
 */
export function useCamera(viewport: Size): UseCameraResult {
  const [camera, setCamera] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);

  // The camera the handlers read from is always the latest one, even before
  // React has rendered it, so gestures compose within a single frame.
  const cameraRef = useRef<Camera>(camera);
  const pendingRef = useRef<Camera | null>(null);
  const frameRef = useRef<number | null>(null);
  const hasNavigatedRef = useRef(false);
  const panFromRef = useRef<Point | null>(null);
  const gestureCameraRef = useRef<Camera | null>(null);
  const gesturePointRef = useRef<Point | null>(null);
  const viewportRef = useRef<Size>(viewport);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  /**
   * Apply a camera produced by camera.math. Updates are coalesced into one
   * render per animation frame; a no-op update (the same object) is dropped so
   * the first-use hint is not dismissed by gestures that changed nothing.
   */
  const commit = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    pendingRef.current = next;
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending !== null) setCamera(pending);
      });
    }
  }, []);

  // Cancel any queued frame on unmount.
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const beginPan = useCallback((p: Point) => {
    panFromRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const from = panFromRef.current;
      if (from === null) return;
      panFromRef.current = p;
      commit(panBy(cameraRef.current, p.x - from.x, p.y - from.y));
    },
    [commit],
  );

  const endPan = useCallback(() => {
    // Whatever the board's position was at the moment the drag ended is kept.
    panFromRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      const viewportSize = viewportRef.current;
      const deltaX = wheelDeltaToPixels(e.deltaX, e.deltaMode, viewportSize);
      const deltaY = wheelDeltaToPixels(e.deltaY, e.deltaMode, viewportSize);
      if (e.ctrlOrMeta) {
        // Trackpad pinch and Ctrl/Cmd + scroll: zoom around the pointer.
        commit(zoomAt(cameraRef.current, e.point, wheelZoomFactor(deltaY)));
        return;
      }
      // Plain scroll: move the board with the scroll, in both axes.
      commit(panBy(cameraRef.current, -deltaX, -deltaY));
    },
    [commit],
  );

  const gestureStart = useCallback((p: Point) => {
    gestureCameraRef.current = cameraRef.current;
    // Remember where the gesture is anchored so the pinch stays centred on it.
    gesturePointRef.current = p;
  }, []);

  const gestureChange = useCallback(
    (p: Point, scale: number) => {
      const start = gestureCameraRef.current ?? cameraRef.current;
      const point = gesturePointRef.current ?? p;
      // GestureEvent.scale is relative to gesturestart, so always derive from
      // the camera captured when the gesture began.
      commit(zoomAt(start, point, scale));
    },
    [commit],
  );

  const gestureEnd = useCallback(() => {
    gestureCameraRef.current = null;
    gesturePointRef.current = null;
  }, []);

  const zoomStep = useCallback(
    (direction: 'in' | 'out') => {
      commit(zoomStepCamera(cameraRef.current, viewportRef.current, direction));
    },
    [commit],
  );

  const reset = useCallback(() => {
    const standard = resetCamera(viewportRef.current);
    commit(sameCamera(cameraRef.current, standard) ? cameraRef.current : standard);
  }, [commit]);

  // Ctrl/Cmd + = / - / 0. Listened to on window so the shortcuts work wherever
  // focus is inside the page, and preventDefault stops the browser's page zoom.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (!event.ctrlKey && !event.metaKey)) return;
      if (event.altKey) return;
      if (ZOOM_IN_KEYS.includes(event.key)) {
        event.preventDefault();
        zoomStep('in');
      } else if (ZOOM_OUT_KEYS.includes(event.key)) {
        event.preventDefault();
        zoomStep('out');
      } else if (RESET_KEYS.includes(event.key)) {
        event.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  const api = useMemo<UseCameraResult>(
    () => ({
      camera,
      hasNavigated,
      beginPan,
      panMove,
      endPan,
      wheel,
      gestureStart,
      gestureChange,
      gestureEnd,
      zoomStep,
      reset,
    }),
    [
      camera,
      hasNavigated,
      beginPan,
      panMove,
      endPan,
      wheel,
      gestureStart,
      gestureChange,
      gestureEnd,
      zoomStep,
      reset,
    ],
  );

  // e2e-only: let tests jump the camera far away (excluded from production).
  useEffect(() => {
    registerTestHooks({
      setCamera: (next) => {
        commit({ x: next.x, y: next.y, zoom: next.zoom });
      },
      getCamera: () => cameraRef.current,
      // publishConnectionState() keeps this up to date (see testHooks.ts).
      connectionState: null,
    });
    return () => clearTestHooks();
  }, [commit]);

  return api;
}

/** Value shared with the board viewport (see App.tsx). */
export interface CameraContextValue extends UseCameraResult {
  viewport: Size;
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

const CameraContext = createContext<CameraContextValue | null>(null);

export const CameraProvider = CameraContext.Provider;

export function useCameraContext(): CameraContextValue {
  const value = useContext(CameraContext);
  if (value === null) {
    throw new Error('BoardViewport must be rendered inside a CameraProvider');
  }
  return value;
}

/** Derive the values the chrome around the board displays from the camera. */
export function useCameraContextValue(api: UseCameraResult, viewport: Size): CameraContextValue {
  return useMemo<CameraContextValue>(
    () => ({
      ...api,
      viewport,
      zoomPercent: zoomPercentCamera(api.camera),
      canZoomIn: canZoomInCamera(api.camera),
      canZoomOut: canZoomOutCamera(api.camera),
    }),
    [api, viewport],
  );
}

/**
 * The board fills the window, so the board area is the window. A ResizeObserver
 * drives re-measurement; the camera is deliberately not adjusted on resize, so
 * content does not move relative to the top-left corner of the board area.
 */
export function useViewportSize(): Size {
  const [size, setSize] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const measure = () => {
      setSize((previous) =>
        previous.width === window.innerWidth && previous.height === window.innerHeight
          ? previous
          : { width: window.innerWidth, height: window.innerHeight },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);

  return size;
}
