import { useCallback, useEffect, useRef, useState } from 'react';
import {
  resetCamera,
  panBy,
  zoomAt,
  zoomStep,
  type Camera,
  type Point,
  type Size,
} from './camera.ts';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config.ts';

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
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  // Safari gesture (pinch): zoom a baseline camera by a cumulative scale ratio.
  gestureZoom(baseline: Camera, point: Point, scale: number): void;
  // Test-only setter, surfaced for the __vidi6 hook (never used in production UI).
  setCamera(camera: Camera): void;
}

export function useCamera(viewport: Size, initial?: Camera): CameraApi {
  const [camera, setCameraState] = useState<Camera>(() => initial ?? resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);

  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const camRef = useRef<Camera>(camera);
  const pendingRef = useRef<Camera | null>(null);
  const rafRef = useRef<number | null>(null);
  const panStart = useRef<{ sx: number; sy: number; cam: Camera } | null>(null);

  // The camera to mutate against: the last committed one, or the coalesced
  // pending update if one is queued for the next frame.
  const base = useCallback(
    () => pendingRef.current ?? camRef.current,
    [],
  );

  const commit = useCallback((next: Camera) => {
    const current = camRef.current;
    if (next === current) return; // no-op (limit/zero delta): do not re-render, do not trip hint
    pendingRef.current = next;
    if (rafRef.current != null) return; // already coalesced a frame
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const c = pendingRef.current;
      pendingRef.current = null;
      if (c == null || c === camRef.current) return;
      camRef.current = c;
      setCameraState(c);
      setHasNavigated(true);
    });
  }, []);

  // Flush any pending frame synchronously on unmount cleanup.
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const beginPan = useCallback((p: Point) => {
    panStart.current = { sx: p.x, sy: p.y, cam: base() };
  }, [base]);

  const panMove = useCallback((p: Point) => {
    const s = panStart.current;
    if (!s) return;
    commit(panBy(s.cam, p.x - s.sx, p.y - s.sy));
  }, [commit]);

  const endPan = useCallback(() => {
    panStart.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        commit(zoomAt(base(), e.point, factor));
      } else {
        // Content moves opposite to the scroll direction (like native scrolling).
        commit(panBy(base(), -e.deltaX, -e.deltaY));
      }
    },
    [base, commit],
  );

  const doZoomStep = useCallback(
    (dir: 'in' | 'out') => {
      commit(zoomStep(base(), viewportRef.current, dir));
    },
    [base, commit],
  );

  const reset = useCallback(() => {
    commit(resetCamera(viewportRef.current));
  }, [commit]);

  const gestureZoom = useCallback(
    (baseline: Camera, point: Point, scale: number) => {
      commit(zoomAt(baseline, point, scale));
    },
    [commit],
  );

  const setCamera = useCallback(
    (next: Camera) => {
      pendingRef.current = next;
      camRef.current = next;
      setCameraState(next);
      setHasNavigated(true);
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
    zoomStep: doZoomStep,
    reset,
    gestureZoom,
    setCamera,
  };
}
