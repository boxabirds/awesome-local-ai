import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type Camera,
  type Point,
  type Size,
  panBy,
  zoomAt,
  zoomStep as zoomStepCalc,
  resetCamera,
} from './camera.ts';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config.ts';
import { registerCameraSetter } from './testHooks.ts';

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  ctrlOrMeta: boolean;
  point: Point;
}

export interface CameraApi {
  camera: Camera;
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  gesture(scale: number, point: Point): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
}

const INITIAL: Camera = { x: 0, y: 0, zoom: 1 };

/**
 * Holds camera state and exposes input handlers. No-op camera updates (the same
 * object returned by camera.math) neither re-render nor trip the navigation
 * latch, which keeps the first-use hint up until a real pan/zoom (TC-29).
 */
export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(INITIAL);
  const [hasNavigated, setHasNavigated] = useState(false);

  const cameraRef = useRef<Camera>(INITIAL);
  const navigatedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<Camera>(INITIAL);

  const viewportRef = useRef<Size>(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  // Apply a camera produced by camera.math. Same object => no-op.
  const apply = useCallback((next: Camera) => {
    if (next === cameraRef.current) return; // identical object: no re-render, no latch
    cameraRef.current = next;
    pendingRef.current = next;
    if (!navigatedRef.current) {
      navigatedRef.current = true;
      setHasNavigated(true);
    }
    if (rafRef.current == null) {
      const run = () => {
        rafRef.current = null;
        setCameraState(pendingRef.current);
      };
      if (typeof requestAnimationFrame === 'function') {
        rafRef.current = requestAnimationFrame(run);
      } else {
        rafRef.current = setTimeout(run, 0) as unknown as number;
      }
    }
  }, []);

  const lastPanRef = useRef<Point | null>(null);

  const beginPan = useCallback((p: Point) => {
    lastPanRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = lastPanRef.current;
      if (last == null) return;
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      lastPanRef.current = p;
      if (dx === 0 && dy === 0) return;
      apply(panBy(cameraRef.current, dx, dy));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    lastPanRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        apply(zoomAt(cameraRef.current, e.point, factor));
      } else {
        // Content moves opposite the scroll direction, like native scrolling.
        apply(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [apply],
  );

  const gesture = useCallback(
    (scale: number, point: Point) => {
      if (!Number.isFinite(scale)) return;
      apply(zoomAt(cameraRef.current, point, scale));
    },
    [apply],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      apply(zoomStepCalc(cameraRef.current, viewportRef.current, dir));
    },
    [apply],
  );

  const reset = useCallback(() => {
    apply(resetCamera(viewportRef.current));
  }, [apply]);

  // Keyboard shortcuts on window: Ctrl/Cmd + (=|-|0).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
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

  useEffect(() => {
    return () => {
      if (rafRef.current != null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // Test-only window.__vidi6.setCamera (jumps far away in e2e; no-op in prod).
  useEffect(() => registerCameraSetter(apply), [apply]);

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
