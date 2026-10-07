// useCamera: React state + input actions for the board camera (story 1).
// The camera lives only in React state and is discarded on reload.

import { useCallback, useRef, useState } from 'react';
import {
  WHEEL_ZOOM_SENSITIVITY,
} from '../../shared/config';
import {
  type Camera,
  type Point,
  type Size,
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepMath,
} from './camera';

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

export interface CameraApi {
  readonly camera: Camera;
  /** Latches true on the first camera change that returns a different object;
   *  never resets during the visit (drives the first-use hint). */
  readonly hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  /** Test hook: set the camera directly (only wired in test mode). */
  setCamera(cam: Camera): void;
}

export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const cameraRef = useRef(camera);
  const initialCameraRef = useRef(camera);
  const panRef = useRef<{ readonly start: Point; readonly camera: Camera } | null>(null);
  const pendingRef = useRef<Camera | null>(null);
  const rafRef = useRef(0);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const hasNavigated = camera !== initialCameraRef.current;

  const commit = useCallback((next: Camera) => {
    cameraRef.current = next;
    setCameraState(next);
  }, []);

  // Camera updates from continuous input are coalesced with
  // requestAnimationFrame to at most one render per frame.
  const schedule = useCallback(
    (next: Camera) => {
      if (next === cameraRef.current) return;
      pendingRef.current = next;
      if (rafRef.current === 0) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          const p = pendingRef.current;
          pendingRef.current = null;
          if (p && p !== cameraRef.current) commit(p);
        });
      }
    },
    [commit],
  );

  const beginPan = useCallback((p: Point) => {
    panRef.current = { start: p, camera: cameraRef.current };
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const pan = panRef.current;
      if (!pan) return;
      schedule(panBy(pan.camera, p.x - pan.start.x, p.y - pan.start.y));
    },
    [schedule],
  );

  const endPan = useCallback(() => {
    panRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        commit(zoomAt(cameraRef.current, e.point, factor));
      } else {
        schedule(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [commit, schedule],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      commit(zoomStepMath(cameraRef.current, viewportRef.current, dir));
    },
    [commit],
  );

  const reset = useCallback(() => {
    commit(resetCamera(viewportRef.current));
  }, [commit]);

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomStep,
    reset,
    setCamera: commit,
  };
}
