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
} from './camera';
import { installTestHooks, parseTestCamera } from './testHooks';

/** A wheel / trackpad scroll over the board, already converted to CSS pixels. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** Ctrl or Cmd held (and a trackpad pinch, which browsers report as such). */
  readonly ctrlOrMeta: boolean;
  /** Pointer position relative to the top-left of the board area. */
  readonly point: Point;
}

export interface CameraApi {
  readonly camera: Camera;
  /** Latches true on the first pan or zoom of this visit (never resets). */
  readonly hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
}

/**
 * Camera state plus every navigation input, as plain methods so the view
 * components stay presentational.
 *
 * Only state is the camera; nothing is persisted, so a reload starts over (per
 * the PRD). Updates are coalesced to at most one render per animation frame.
 */
export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);

  /** Latest camera, readable synchronously inside handlers. */
  const cameraRef = useRef<Camera>(camera);
  /** Latch: one-way, so the hint cannot come back during a visit. */
  const navigatedRef = useRef(false);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<Camera | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (frameRef.current !== null) {
        cancelFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  /**
   * Commit a camera produced by camera.math. A no-op update (the same object,
   * e.g. a click without movement, or a zoom already at its limit) renders
   * nothing and does not dismiss the navigation hint.
   */
  const apply = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    pendingRef.current = next;
    if (!navigatedRef.current) {
      navigatedRef.current = true;
      setHasNavigated(true);
    }
    if (frameRef.current === null) {
      frameRef.current = requestFrame(() => {
        frameRef.current = null;
        const value = pendingRef.current;
        if (mountedRef.current && value) setCameraState(value);
      });
    }
  }, []);

  const panFromRef = useRef<Point | null>(null);

  const beginPan = useCallback((p: Point) => {
    panFromRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const from = panFromRef.current;
      if (from === null) return;
      panFromRef.current = p;
      apply(panBy(cameraRef.current, p.x - from.x, p.y - from.y));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    // Whatever the board's position at the moment the drag ended stays put.
    panFromRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        apply(
          zoomAt(
            cameraRef.current,
            e.point,
            Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY),
          ),
        );
      } else {
        // Scroll down moves content up, scroll right moves content left.
        apply(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [apply],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      apply(zoomStepCamera(cameraRef.current, viewportRef.current, dir));
    },
    [apply],
  );

  const reset = useCallback(() => {
    apply(resetCamera(viewportRef.current));
  }, [apply]);

  // Ctrl/Cmd + = , - and 0. Preventing the default stops the browser's own page
  // zoom, which is the whole point of `zoom.no_page_zoom`.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (isZoomInKey(event)) {
        event.preventDefault();
        zoomStep('in');
      } else if (isZoomOutKey(event)) {
        event.preventDefault();
        zoomStep('out');
      } else if (isResetKey(event)) {
        event.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  useEffect(() => {
    installTestHooks({
      setCamera: (value) => {
        const parsed = parseTestCamera(value);
        if (parsed) apply(parsed);
      },
      getCamera: () => cameraRef.current,
    });
    return () => installTestHooks(null);
  }, [apply]);

  return useMemo(
    () => ({ camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset }),
    [camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset],
  );
}

/**
 * Size of the board area, which fills the window. A resize changes only how
 * much of the board is visible: the camera's top-left anchor is deliberately
 * untouched, so content keeps its position relative to the top-left corner.
 */
export function useViewportSize(): Size {
  const [size, setSize] = useState<Size>(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }));

  useEffect(() => {
    const measure = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (width <= 0 || height <= 0) return;
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };
    measure();
    window.addEventListener('resize', measure);
    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    return () => {
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, []);

  return size;
}

// ---- zoom shortcut matching ----

function isZoomInKey(event: KeyboardEvent): boolean {
  return event.key === '=' || event.key === '+' || event.code === 'Equal';
}

function isZoomOutKey(event: KeyboardEvent): boolean {
  return event.key === '-' || event.key === '_' || event.code === 'Minus';
}

function isResetKey(event: KeyboardEvent): boolean {
  return event.key === '0' || event.code === 'Digit0';
}

// ---- animation frame scheduling (with a fallback for bare jsdom) ----

const HAS_ANIMATION_FRAME =
  typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';

function requestFrame(callback: () => void): number {
  if (HAS_ANIMATION_FRAME) return window.requestAnimationFrame(() => callback());
  return window.setTimeout(callback, 0) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (HAS_ANIMATION_FRAME) window.cancelAnimationFrame(handle);
  else window.clearTimeout(handle as unknown as number);
}
