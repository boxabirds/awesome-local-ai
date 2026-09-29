import { useCallback, useEffect, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as cameraZoomStep,
  type Camera,
  type Point,
  type Size,
} from './camera';
import { registerTestHooks } from './testHooks';

/** The viewport's interaction mode (design: State diagram). */
export type InteractionMode = 'idle' | 'panning';

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

export interface UseCameraResult {
  readonly camera: Camera;
  /** Latched true on the first camera *change* of the visit (a camera update
   * that returns a new object); never resets except by a page reload. */
  readonly hasNavigated: boolean;
  readonly mode: InteractionMode;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Zoom by an arbitrary factor around a screen point (Safari gesture scale). */
  zoomAtPointer(point: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
}

/**
 * Camera state plus the input handlers that drive it. All camera mutations go
 * through camera.math and are coalesced with requestAnimationFrame so at most
 * one render happens per frame. Nothing is persisted: a reload discards it.
 */
export function useCamera(viewport: Size): UseCameraResult {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const [mode, setMode] = useState<InteractionMode>('idle');

  /** Latest committed camera (React state can lag behind by a frame). */
  const cameraRef = useRef<Camera>(camera);
  /** Camera queued for the next animation frame, if any. */
  const pendingRef = useRef<Camera | null>(null);
  const rafRef = useRef<number | null>(null);
  const navigatedRef = useRef(false);
  const viewportRef = useRef<Size>(viewport);
  /** Screen point of the last handled pointermove, or null while Idle. */
  const panOriginRef = useRef<Point | null>(null);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const currentCamera = useCallback(
    () => pendingRef.current ?? cameraRef.current,
    [],
  );

  const flush = useCallback(() => {
    rafRef.current = null;
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next === null) return;
    cameraRef.current = next;
    setCameraState(next);
  }, []);

  /** Queue a camera produced by camera.math. camera.math signals a no-op by
   * returning the same object, which does not render and does not trip the
   * navigation latch (TC-05, TC-29). */
  const commit = useCallback(
    (next: Camera) => {
      const base = pendingRef.current ?? cameraRef.current;
      if (next === base) return;
      pendingRef.current = next;
      navigatedRef.current = true;
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  const beginPan = useCallback((p: Point) => {
    if (panOriginRef.current !== null) return;
    panOriginRef.current = p;
    setMode('panning');
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const origin = panOriginRef.current;
      if (origin === null) return; // Idle: pointermove after the drag ended is ignored
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      if (dx === 0 && dy === 0) return;
      panOriginRef.current = p;
      commit(panBy(currentCamera(), dx, dy));
    },
    [commit, currentCamera],
  );

  const endPan = useCallback(() => {
    if (panOriginRef.current === null) return;
    panOriginRef.current = null;
    setMode('idle');
  }, []);

  const zoomAtPointer = useCallback(
    (point: Point, factor: number) => {
      commit(zoomAt(currentCamera(), point, factor));
    },
    [commit, currentCamera],
  );

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        // Pinch (trackpad/Chromium+Firefox) or Ctrl/Cmd + wheel: zoom around
        // the pointer, keeping the board location under it in place.
        zoomAtPointer(e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY));
      } else {
        // Plain scroll: move the board in the scroll direction.
        commit(panBy(currentCamera(), -e.deltaX, -e.deltaY));
      }
    },
    [commit, currentCamera, zoomAtPointer],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      commit(cameraZoomStep(currentCamera(), viewportRef.current, dir));
    },
    [commit, currentCamera],
  );

  const reset = useCallback(() => {
    commit(resetCamera(viewportRef.current));
  }, [commit, currentCamera]);

  // The e2e test hook can jump the camera anywhere on the board.
  useEffect(() => {
    registerTestHooks({ setCamera: commit, getCamera: currentCamera });
  }, [commit, currentCamera]);

  // Cancel a queued frame on unmount.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    },
    [],
  );

  return {
    camera,
    hasNavigated: navigatedRef.current,
    mode,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAtPointer,
    zoomStep,
    reset,
  };
}
