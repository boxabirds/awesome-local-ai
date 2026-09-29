import { useCallback, useRef, useState, type RefObject } from "react";
import {
  type Camera,
  type Point,
  type Size,
  panBy,
  zoomAt,
  zoomStep,
  resetCamera,
} from "./camera";
import { WHEEL_LINE_HEIGHT, WHEEL_PAGE_HEIGHT, WHEEL_ZOOM_SENSITIVITY } from "@shared/config";

export interface WheelArgs {
  deltaX: number;
  deltaY: number;
  deltaMode: number; // 0 pixel, 1 line, 2 page
  ctrlOrMeta: boolean;
  point: Point;
}

export interface CameraApi {
  camera: Camera;
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelArgs): void;
  gesture(scale: number, p: Point): void;
  zoomStep(dir: "in" | "out"): void;
  reset(): void;
  /** Replace the whole camera (test hook / far-jump). */
  setCamera(next: Camera): void;
}

/**
 * Owns camera state + the imperative input handlers. The latest camera lives in a
 * ref so handler maths always reads the current value, even when several events
 * arrive within one frame. `viewportRef` is updated externally (a ResizeObserver in
 * BoardViewport) and read only for step / reset maths.
 */
export function useCamera(viewportRef: RefObject<Size>): CameraApi {
  const startSize = viewportRef.current;
  const [camera, setCameraState] = useState<Camera>({
    x: -startSize.width / 2,
    y: -startSize.height / 2,
    zoom: 1,
  });
  const [hasNavigated, setHasNavigated] = useState(false);

  const cameraRef = useRef<Camera>(camera);
  const lastPointerRef = useRef<Point | null>(null);

  const commit = useCallback((next: Camera) => {
    // A no-op camera update (same object) does not trip the hint or re-render.
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    setCameraState(next);
    setHasNavigated(true);
  }, []);

  const beginPan = useCallback((p: Point) => {
    lastPointerRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = lastPointerRef.current;
      if (!last) return;
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      if (dx === 0 && dy === 0) return;
      lastPointerRef.current = p;
      commit(panBy(cameraRef.current, dx, dy));
    },
    [commit],
  );

  const endPan = useCallback(() => {
    lastPointerRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelArgs) => {
      const factor =
        e.deltaMode === 1 ? WHEEL_LINE_HEIGHT : e.deltaMode === 2 ? WHEEL_PAGE_HEIGHT : 1;
      const dx = e.deltaX * factor;
      const dy = e.deltaY * factor;
      if (e.ctrlOrMeta) {
        const zoomFactor = Math.exp(-dy * WHEEL_ZOOM_SENSITIVITY);
        commit(zoomAt(cameraRef.current, e.point, zoomFactor));
      } else {
        // Plain scroll: content moves opposite the scroll direction (native feel).
        commit(panBy(cameraRef.current, -dx, -dy));
      }
    },
    [commit],
  );

  const gesture = useCallback(
    (scale: number, p: Point) => {
      commit(zoomAt(cameraRef.current, p, scale));
    },
    [commit],
  );

  const zoomStepDir = useCallback(
    (dir: "in" | "out") => {
      commit(zoomStep(cameraRef.current, viewportRef.current, dir));
    },
    // viewportRef is a stable ref; its .current is read at call time.
    [commit, viewportRef],
  );

  const reset = useCallback(() => {
    commit(resetCamera(viewportRef.current));
  }, [commit, viewportRef]);

  const setCamera = useCallback((next: Camera) => commit(next), [commit]);

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    gesture,
    zoomStep: zoomStepDir,
    reset,
    setCamera,
  };
}
