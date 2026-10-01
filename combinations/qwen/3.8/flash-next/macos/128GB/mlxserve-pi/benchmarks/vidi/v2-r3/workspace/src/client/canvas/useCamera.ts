import { useCallback, useEffect, useRef, useState } from 'react';
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
import { installTestHooks } from './testHooks';

/** A normalised wheel/trackpad event over the board (deltas in pixels). */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

export interface CameraApi {
  camera: Camera;
  /** Latches true on the first camera change (pan or zoom) of the visit. */
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Zoom around a screen point by a factor (used by Safari gesture events). */
  zoomAtPoint(point: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
}

const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/**
 * Camera state + navigation actions. All mutations go through camera.math,
 * are coalesced with requestAnimationFrame (at most one render per frame),
 * and return the same camera object when they are a no-op so React skips the
 * re-render. Nothing is persisted: reload starts fresh.
 */
export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(INITIAL_CAMERA);
  const [hasNavigated, setHasNavigated] = useState(false);
  const cameraRef = useRef<Camera>(INITIAL_CAMERA);
  const navigatedRef = useRef(false);
  const rafRef = useRef(0);
  const lastPointerRef = useRef<Point | null>(null);
  const viewportRef = useRef<Size>(viewport);
  const initialisedRef = useRef(false);

  useEffect(() => {
    viewportRef.current = viewport;
    // Centre the board's starting point once, as soon as the real viewport
    // size is known — but only if nothing (user or test hook) already moved
    // the camera. Later resizes deliberately do NOT move content relative
    // to the top-left corner of the board area.
    if (!initialisedRef.current && viewport.width > 0 && viewport.height > 0) {
      initialisedRef.current = true;
      if (cameraRef.current === INITIAL_CAMERA) {
        const centred: Camera = {
          ...cameraRef.current,
          x: -viewport.width / 2,
          y: -viewport.height / 2,
        };
        cameraRef.current = centred;
        setCameraState(centred);
      }
    }
  }, [viewport]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /** Apply a camera produced by camera.math; a same-object input is a no-op. */
  const apply = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    if (!navigatedRef.current) {
      navigatedRef.current = true;
      setHasNavigated(true);
    }
    if (rafRef.current === 0) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        setCameraState(cameraRef.current);
      });
    }
  }, []);

  const beginPan = useCallback((p: Point) => {
    lastPointerRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = lastPointerRef.current;
      if (last === null) return;
      lastPointerRef.current = p;
      apply(panBy(cameraRef.current, p.x - last.x, p.y - last.y));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    lastPointerRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        // Pinch (trackpad) or Ctrl/Cmd + wheel: zoom around the pointer.
        apply(zoomAt(cameraRef.current, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        // Plain scroll: move the board in the scroll direction.
        apply(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [apply],
  );

  const zoomAtPoint = useCallback(
    (point: Point, factor: number) => {
      apply(zoomAt(cameraRef.current, point, factor));
    },
    [apply],
  );

  const zoomStep = useCallback((dir: 'in' | 'out') => {
    apply(zoomStepCamera(cameraRef.current, viewportRef.current, dir));
  }, []);

  const reset = useCallback(() => {
    apply(resetCamera(viewportRef.current));
  }, []);

  useEffect(() => {
    installTestHooks(
      (next: Camera) => {
        // Direct set (test-only): does not count as user navigation.
        cameraRef.current = next;
        if (rafRef.current !== 0) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        setCameraState(next);
      },
      () => cameraRef.current,
    );
  }, []);

  return { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomAtPoint, zoomStep, reset };
}
