import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  DELTA_MODE_LINE,
  DELTA_MODE_PAGE,
  WHEEL_LINE_DELTA_PX,
  WHEEL_PAGE_DELTA_PX,
  WHEEL_ZOOM_SENSITIVITY,
} from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepAt,
  type Camera,
  type Point,
  type Size,
  type ZoomDirection,
} from './camera';

export type { Camera, Point, Size, ZoomDirection };

/** A wheel / trackpad scroll ready to be applied to the camera. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

/**
 * Everything the board surface and the zoom controls need from the camera.
 * All mutators are safe no-ops when camera.math says nothing changed.
 */
export interface CameraController {
  readonly camera: Camera;
  /** Latches true on the first camera change of this visit (never resets). */
  readonly hasNavigated: boolean;
  /** True while a drag-to-pan gesture is in progress. */
  readonly isPanning: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(input: WheelInput): void;
  /** Safari pinch: `scale` is the gesture scale around the pointer. */
  gesture(point: Point, scale: number, initialScale?: number): void;
  endGesture(): void;
  zoomStep(direction: ZoomDirection): void;
  reset(): void;
  /** Used by the test-only `window.__vidi6` hook. */
  setCamera(next: Camera): void;
}

/** Convert a `WheelEvent` delta (any deltaMode) into CSS pixels. */
export function wheelDeltaToPixels(delta: number, deltaMode: number): number {
  if (!Number.isFinite(delta) || delta === 0) {
    return 0;
  }
  if (deltaMode === DELTA_MODE_LINE) {
    return delta * WHEEL_LINE_DELTA_PX;
  }
  if (deltaMode === DELTA_MODE_PAGE) {
    return delta * WHEEL_PAGE_DELTA_PX;
  }
  return delta;
}

/** Zoom factor for a wheel/pinch delta, per WHEEL_ZOOM_SENSITIVITY. */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY);
}

/**
 * Camera state plus the gesture handlers, held in React state. Updates are
 * coalesced to at most one render per animation frame.
 */
export function useCamera(viewport: Size): CameraController {
  const viewportRef = useRef<Size>(viewport);
  viewportRef.current = viewport;

  // Camera lives only in memory: nothing is persisted across reloads.
  const cameraRef = useRef<Camera>(resetCamera(viewport));
  const [cameraState, setCameraState] = useState<Camera>(cameraRef.current);
  const navigatedRef = useRef(false);
  const [hasNavigated, setHasNavigated] = useState(false);
  const panningRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const lastPanPointRef = useRef<Point | null>(null);
  const gestureScaleRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  const flush = useCallback((): void => {
    frameRef.current = null;
    setCameraState(cameraRef.current);
  }, []);

  const schedule = useCallback((): void => {
    if (frameRef.current !== null) {
      return;
    }
    if (typeof requestAnimationFrame === 'function') {
      frameRef.current = requestAnimationFrame(flush);
    } else {
      frameRef.current = setTimeout(flush, 16) as unknown as number;
    }
  }, [flush]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(frameRef.current);
        } else {
          clearTimeout(frameRef.current);
        }
        frameRef.current = null;
      }
    },
    [],
  );

  /** Apply a camera returned by camera.math; identical objects are ignored. */
  const apply = useCallback(
    (next: Camera): void => {
      if (next === cameraRef.current) {
        return;
      }
      cameraRef.current = next;
      if (!navigatedRef.current) {
        navigatedRef.current = true;
        setHasNavigated(true);
      }
      schedule();
    },
    [schedule],
  );

  const beginPan = useCallback(
    (p: Point): void => {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        return;
      }
      lastPanPointRef.current = p;
      if (!panningRef.current) {
        panningRef.current = true;
        setIsPanning(true);
      }
    },
    [],
  );

  const panMove = useCallback(
    (p: Point): void => {
      const last = lastPanPointRef.current;
      if (!last || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        return;
      }
      lastPanPointRef.current = p;
      apply(panBy(cameraRef.current, p.x - last.x, p.y - last.y));
    },
    [apply],
  );

  const endPan = useCallback((): void => {
    lastPanPointRef.current = null;
    if (panningRef.current) {
      panningRef.current = false;
      setIsPanning(false);
    }
  }, []);

  const wheel = useCallback(
    (input: WheelInput): void => {
      if (input.ctrlOrMeta) {
        apply(zoomAt(cameraRef.current, input.point, wheelZoomFactor(input.deltaY)));
        return;
      }
      apply(panBy(cameraRef.current, -input.deltaX, -input.deltaY));
    },
    [apply],
  );

  const gesture = useCallback(
    (point: Point, scale: number, initialScale = 1): void => {
      if (!Number.isFinite(scale) || scale <= 0) {
        return;
      }
      const previous = gestureScaleRef.current ?? (Number.isFinite(initialScale) && initialScale > 0 ? initialScale : 1);
      gestureScaleRef.current = scale;
      apply(zoomAt(cameraRef.current, point, scale / previous));
    },
    [apply],
  );

  const endGesture = useCallback((): void => {
    gestureScaleRef.current = null;
  }, []);

  const zoomStep = useCallback(
    (direction: ZoomDirection): void => {
      apply(zoomStepAt(cameraRef.current, viewportRef.current, direction));
    },
    [apply],
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

  return {
    camera: cameraState,
    hasNavigated,
    isPanning,
    beginPan,
    panMove,
    endPan,
    wheel,
    gesture,
    endGesture,
    zoomStep,
    reset,
    setCamera,
  };
}

/** Shared so App can wire the zoom controls to the same camera the board renders. */
export const BoardControllerContext = createContext<CameraController | null>(null);

export function useBoardController(): CameraController {
  const controller = useContext(BoardControllerContext);
  if (!controller) {
    throw new Error('BoardControllerContext is missing; render BoardViewport inside a provider');
  }
  return controller;
}

function measureSize(el: HTMLElement | null): Size {
  if (el && el.clientWidth > 0 && el.clientHeight > 0) {
    return { width: el.clientWidth, height: el.clientHeight };
  }
  if (typeof window !== 'undefined') {
    return { width: window.innerWidth, height: window.innerHeight };
  }
  return { width: 0, height: 0 };
}

/**
 * Board area size, tracked with a ResizeObserver (window resize as a fallback).
 * Only centre-based operations (zoom step, reset) consult it; the camera itself
 * is never re-derived, so a resize never moves content.
 */
export function useViewportSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>(() => measureSize(ref.current));

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    setSize(measureSize(el));

    if (typeof ResizeObserver === 'undefined') {
      const onResize = (): void => setSize(measureSize(el));
      window.addEventListener('resize', onResize);
      return () => {
        window.removeEventListener('resize', onResize);
      };
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const width = entry.contentRect.width || el.clientWidth;
      const height = entry.contentRect.height || el.clientHeight;
      setSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return size;
}
