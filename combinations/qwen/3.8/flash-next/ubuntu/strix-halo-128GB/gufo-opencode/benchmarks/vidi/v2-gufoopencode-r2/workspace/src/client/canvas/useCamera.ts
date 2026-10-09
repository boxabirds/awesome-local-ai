import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type Camera,
  type Point,
  type Size,
  panBy,
  zoomAt,
  zoomStep as zoomStepAt,
  resetCamera,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import { installTestHook } from './testHooks';

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

export interface CameraApi {
  camera: Camera;
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomBy(factor: number, point: Point): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
}

export function useCamera(viewport: Size): CameraApi {
  const [camera, setCamera] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);
  const cameraRef = useRef(camera);
  const navigatedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const panOriginRef = useRef<Point | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Single funnel for all camera changes: keeps the ref in sync immediately
  // (so rapid gestures compose exactly), latches hasNavigated only when the
  // camera really changed, and coalesces renders to one per animation frame.
  const commit = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    if (!navigatedRef.current) {
      navigatedRef.current = true;
      setHasNavigated(true);
    }
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setCamera(cameraRef.current);
      });
    }
  }, []);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  // First known viewport size sets the standard starting view (origin centred,
  // 100%). This is initialisation, not navigation: it must not dismiss the hint.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current && viewport.width > 0 && viewport.height > 0) {
      initializedRef.current = true;
      const initial = resetCamera(viewport);
      if (initial !== cameraRef.current) {
        cameraRef.current = initial;
        setCamera(initial);
      }
    }
  }, [viewport]);

  const beginPan = useCallback((p: Point) => {
    panOriginRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const origin = panOriginRef.current;
      if (!origin) return;
      panOriginRef.current = p;
      commit(panBy(cameraRef.current, p.x - origin.x, p.y - origin.y));
    },
    [commit],
  );

  const endPan = useCallback(() => {
    panOriginRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        commit(zoomAt(cameraRef.current, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        commit(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [commit],
  );

  const zoomBy = useCallback(
    (factor: number, point: Point) => {
      commit(zoomAt(cameraRef.current, point, factor));
    },
    [commit],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      commit(zoomStepAt(cameraRef.current, viewportRef.current, dir));
    },
    [commit],
  );

  const reset = useCallback(() => {
    commit(resetCamera(viewportRef.current));
  }, [commit]);

  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      installTestHook({
        setCamera: (next: Camera) => commit({ x: next.x, y: next.y, zoom: next.zoom }),
        getCamera: () => cameraRef.current,
      });
    }
  }, [commit]);

  return { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomBy, zoomStep, reset };
}
