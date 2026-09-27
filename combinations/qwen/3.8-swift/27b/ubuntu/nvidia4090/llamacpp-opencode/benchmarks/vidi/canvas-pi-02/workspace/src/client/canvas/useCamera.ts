// React hook owning the camera state and all navigation intents.
// Camera updates are batched to at most one render per animation frame.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepMath,
  type Camera,
  type Point,
  type Size,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY, CAMERA_FLUSH_FALLBACK_MS } from '../../shared/config';

export interface WheelInput {
  /** Screen-space scroll delta in CSS pixels (deltaMode already converted). */
  deltaX: number;
  deltaY: number;
  /** True when Ctrl or Cmd is held: zoom instead of pan. */
  ctrlOrMeta: boolean;
  /** Screen point of the gesture, in the viewport's CSS pixels. */
  point: Point;
}

export interface CameraApi {
  camera: Camera;
  /** Latches true on the first camera change that produces a new camera. */
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Zoom by an explicit factor around a screen point (Safari pinch). */
  zoomAtPoint(point: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  /** Jump the camera to an exact value (test hook). */
  setCamera(cam: Camera): void;
}

export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const cameraRef = useRef(camera);
  const [hasNavigated, setHasNavigated] = useState(false);
  const hasNavigatedRef = useRef(false);
  const pendingRef = useRef<Camera | null>(null);
  const rafRef = useRef<number | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const panLastRef = useRef<Point | null>(null);
  const sizedRef = useRef(false);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const current = useCallback(
    () => pendingRef.current ?? cameraRef.current,
    [],
  );

  const flushPending = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const cam = pendingRef.current;
    if (cam !== null && cam !== cameraRef.current) {
      cameraRef.current = cam;
      setCameraState(cam);
    }
  }, []);

  const applyCamera = useCallback(
    (next: Camera) => {
      if (next === cameraRef.current && next === pendingRef.current) return;
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        setHasNavigated(true);
      }
      pendingRef.current = next;
      // Batch to one render per paint frame; the timer guarantees a flush in
      // environments where no paint frame is produced (e.g. headless WebKit).
      if (rafRef.current === null && flushTimerRef.current === null) {
        rafRef.current = requestAnimationFrame(flushPending);
        flushTimerRef.current = window.setTimeout(flushPending, CAMERA_FLUSH_FALLBACK_MS);
      }
    },
    [flushPending],
  );

  // Centre the board's starting point once the viewport first has a size.
  // This initial placement is not a navigation: it does not trip the latch.
  useEffect(() => {
    if (viewport.width > 0 && viewport.height > 0 && !sizedRef.current) {
      sizedRef.current = true;
      const next = resetCamera(viewport);
      if (next !== cameraRef.current) {
        cameraRef.current = next;
        pendingRef.current = null;
        setCameraState(next);
      }
    }
  }, [viewport]);

  const beginPan = useCallback((p: Point) => {
    panLastRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = panLastRef.current;
      if (last === null) return;
      panLastRef.current = p;
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      if (dx === 0 && dy === 0) return;
      applyCamera(panBy(current(), dx, dy));
    },
    [applyCamera, current],
  );

  const endPan = useCallback(() => {
    panLastRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        applyCamera(zoomAt(current(), e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        applyCamera(panBy(current(), -e.deltaX, -e.deltaY));
      }
    },
    [applyCamera, current],
  );

  const zoomAtPoint = useCallback(
    (point: Point, factor: number) => {
      applyCamera(zoomAt(current(), point, factor));
    },
    [applyCamera, current],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      applyCamera(zoomStepMath(current(), viewportRef.current, dir));
    },
    [applyCamera, current],
  );

  const reset = useCallback(() => {
    applyCamera(resetCamera(viewportRef.current));
  }, [applyCamera]);

  const setCamera = useCallback(
    (cam: Camera) => {
      applyCamera(cam);
    },
    [applyCamera],
  );

  // Ctrl/Cmd + = / - / 0 shortcuts on the window.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  // Cancel pending work on unmount.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    },
    [],
  );

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAtPoint,
    zoomStep,
    reset,
    setCamera,
  };
}
