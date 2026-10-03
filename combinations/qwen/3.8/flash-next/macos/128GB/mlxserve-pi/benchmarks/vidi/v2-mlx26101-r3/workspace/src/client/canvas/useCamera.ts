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
  type ZoomDirection,
} from './camera';
import { registerCameraHook } from '../testHooks';

/** A wheel/trackpad scroll over the board, with deltas already converted to pixels. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

/** A Safari pinch (`gesturechange`), `scale` being the ratio since the gesture started. */
export interface GestureInput {
  readonly scale: number;
  readonly point: Point;
}

/** Everything the input surface needs to drive the camera. */
export interface CameraInputHandlers {
  beginPan(point: Point): void;
  panMove(point: Point): void;
  endPan(): void;
  wheel(input: WheelInput): void;
  gesture(input: GestureInput): void;
  zoomStep(direction: ZoomDirection): void;
  reset(): void;
}

export interface UseCameraResult extends CameraInputHandlers {
  readonly camera: Camera;
  /** Latches true on the first camera change of the visit and never resets. */
  readonly hasNavigated: boolean;
}

/**
 * Camera state plus the input handlers that drive it.
 *
 * Camera updates are coalesced with requestAnimationFrame so a burst of pointer
 * or wheel events causes at most one render per frame.
 */
export function useCamera(viewport: Size): UseCameraResult {
  // The standard view is derived from the window size at first render; a later resize
  // never moves the camera (design Flows: camera x, y is the top-left of the board area).
  const [camera, setCamera] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);

  const cameraRef = useRef(camera);
  const pendingRef = useRef<Camera | null>(null);
  const frameRef = useRef<number | null>(null);
  const navigatedRef = useRef(false);
  const panPointerRef = useRef<Point | null>(null);
  const viewportRef = useRef(viewport);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const flush = useCallback((): void => {
    frameRef.current = null;
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next === null) {
      return;
    }
    setCamera(next);
  }, []);

  const schedule = useCallback((): void => {
    if (frameRef.current !== null) {
      return;
    }
    frameRef.current = requestAnimationFrame(flush);
  }, [flush]);

  /** Commit a camera produced by camera.math; a no-op result is ignored. */
  const apply = useCallback(
    (next: Camera): void => {
      if (next === cameraRef.current) {
        return;
      }
      cameraRef.current = next;
      pendingRef.current = next;
      if (!navigatedRef.current) {
        navigatedRef.current = true;
        setHasNavigated(true);
      }
      schedule();
    },
    [schedule],
  );

  const beginPan = useCallback(
    (point: Point): void => {
      panPointerRef.current = point;
    },
    [],
  );

  const panMove = useCallback(
    (point: Point): void => {
      const last = panPointerRef.current;
      if (last === null) {
        return;
      }
      panPointerRef.current = point;
      apply(panBy(cameraRef.current, point.x - last.x, point.y - last.y));
    },
    [apply],
  );

  const endPan = useCallback((): void => {
    panPointerRef.current = null;
  }, []);

  const wheel = useCallback(
    (input: WheelInput): void => {
      if (input.ctrlOrMeta) {
        // Pinch and Ctrl/Cmd + scroll: zoom around the pointer.
        apply(zoomAt(cameraRef.current, input.point, Math.exp(-input.deltaY * WHEEL_ZOOM_SENSITIVITY)));
        return;
      }
      apply(panBy(cameraRef.current, -input.deltaX, -input.deltaY));
    },
    [apply],
  );

  const gesture = useCallback(
    (input: GestureInput): void => {
      apply(zoomAt(cameraRef.current, input.point, input.scale));
    },
    [apply],
  );

  const zoomStep = useCallback(
    (direction: ZoomDirection): void => {
      apply(zoomStepCamera(cameraRef.current, viewportRef.current, direction));
    },
    [apply],
  );

  const reset = useCallback((): void => {
    apply(resetCamera(viewportRef.current));
  }, [apply]);

  // Keyboard zoom shortcuts. preventDefault stops the browser zooming the page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      if (event.altKey) {
        return;
      }
      if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        zoomStep('in');
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomStep('out');
      } else if (event.key === '0') {
        event.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [zoomStep, reset]);

  // Test-only hook used by e2e to jump far away.
  useEffect(
    () =>
      registerCameraHook((partial: Partial<Camera>): void => {
        const current = cameraRef.current;
        const next: Camera = {
          x: partial.x ?? current.x,
          y: partial.y ?? current.y,
          zoom: partial.zoom ?? current.zoom,
        };
        apply(next);
      }),
    [apply],
  );

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

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
