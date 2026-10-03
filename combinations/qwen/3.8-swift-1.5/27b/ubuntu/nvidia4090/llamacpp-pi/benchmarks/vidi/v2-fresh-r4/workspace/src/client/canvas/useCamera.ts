import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type Camera,
  type Point,
  type Size,
  panBy,
  resetCamera,
  zoomAt,
  zoomStep,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import { registerSetCamera } from './testHooks';

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  ctrlOrMeta: boolean;
  point: Point;
}

export interface CameraApi {
  camera: Camera;
  /** Latches true on the first user-initiated camera change; never resets for the visit. */
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomStep(direction: 'in' | 'out'): void;
  reset(): void;
}

/**
 * Camera state plus navigation actions.
 *
 * - The camera lives only in React state (nothing is persisted).
 * - Continuous input (drag, wheel) is coalesced with requestAnimationFrame so
 *   there is at most one render per frame.
 * - `hasNavigated` is a ref-backed latch: it flips only when a user action
 *   produces a *different* camera object, so no-ops (click without movement,
 *   zoom at a limit) never dismiss the first-use hint.
 */
export function useCamera(viewport: Size): CameraApi {
  const [camera, setCamera] = useState<Camera>(() => resetCamera(viewport));
  const cameraRef = useRef(camera);
  const [hasNavigated, setHasNavigated] = useState(false);
  const hasNavigatedRef = useRef(false);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const commit = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    setCamera(next);
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
  }, []);

  // Once the viewport has a real size, centre the board's starting point.
  // This is not user navigation, so it must not trip the hasNavigated latch.
  const initializedRef = useRef(viewport.width > 0 && viewport.height > 0);
  useEffect(() => {
    if (!initializedRef.current && viewport.width > 0 && viewport.height > 0) {
      initializedRef.current = true;
      cameraRef.current = resetCamera(viewport);
      setCamera(cameraRef.current);
    }
  }, [viewport]);

  // rAF coalescing for continuous input.
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ panDx: number; panDy: number; zoomFactor: number; zoomPoint: Point | null } | null>(null);

  const flush = useCallback(() => {
    frameRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    let cam = cameraRef.current;
    if (pending.zoomFactor !== 1 && pending.zoomPoint) {
      cam = zoomAt(cam, pending.zoomPoint, pending.zoomFactor);
    }
    if (pending.panDx !== 0 || pending.panDy !== 0) {
      cam = panBy(cam, pending.panDx, pending.panDy);
    }
    commit(cam);
  }, [commit]);

  const schedule = useCallback(
    (update: (pending: NonNullable<typeof pendingRef.current>) => void) => {
      if (!pendingRef.current) {
        pendingRef.current = { panDx: 0, panDy: 0, zoomFactor: 1, zoomPoint: null };
      }
      update(pendingRef.current);
      if (frameRef.current == null) {
        frameRef.current = requestAnimationFrame(flush);
      }
    },
    [flush],
  );

  const lastPanPointRef = useRef<Point | null>(null);

  const beginPan = useCallback((p: Point) => {
    lastPanPointRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = lastPanPointRef.current;
      if (!last) return;
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      if (dx === 0 && dy === 0) return;
      lastPanPointRef.current = p;
      schedule((pending) => {
        pending.panDx += dx;
        pending.panDy += dy;
      });
    },
    [schedule],
  );

  const endPan = useCallback(() => {
    lastPanPointRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        // Zoom around the pointer: factor = exp(-deltaY * sensitivity).
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        schedule((pending) => {
          pending.zoomFactor *= factor;
          pending.zoomPoint = e.point;
        });
      } else {
        // Plain scroll pans: content moves in the scroll direction.
        schedule((pending) => {
          pending.panDx -= e.deltaX;
          pending.panDy -= e.deltaY;
        });
      }
    },
    [schedule],
  );

  // Discrete actions commit immediately (camera.math handles stepping,
  // snapping, clamping and same-object no-ops).
  const zoomStepAction = useCallback(
    (direction: 'in' | 'out') => {
      commit(zoomStep(cameraRef.current, viewportRef.current, direction));
    },
    [commit],
  );

  const reset = useCallback(() => {
    commit(resetCamera(viewportRef.current));
  }, [commit]);

  // Test hook (only registered into window.__vidi6 in test mode).
  useEffect(() => {
    registerSetCamera((next) => {
      pendingRef.current = null;
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      cameraRef.current = next;
      setCamera(next);
    });
    return () => registerSetCamera(null);
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomStep: zoomStepAction,
    reset,
  };
}
