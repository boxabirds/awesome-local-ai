import { useState, useRef, useEffect, useCallback } from 'react';
import type { Camera, Point, Size } from './camera';
import {
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  zoomStep,
  resetCamera as resetCameraMath,
  canZoomIn,
  canZoomOut,
  zoomPercent,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY, LINE_TO_PIXELS, PAGE_TO_PIXELS } from '../../shared/config';


export function useCamera(viewport: Size) {
  const [camera, setCamera] = useState<Camera>(() => ({
    x: -viewport.width / 2,
    y: -viewport.height / 2,
    zoom: 1,
  }));
  const isPanningRef = useRef(false);
  // Ref-backed latch: flips once on a real camera change, never resets
  const hasNavigatedRef = useRef(false);

  const notifyNavigated = useCallback(() => {
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
    }
  }, []);

  // Coalesced state update via requestAnimationFrame
  const pendingRef = useRef<Camera | null>(null);
  const rAFRef = useRef<number | null>(null);

  const scheduleUpdate = useCallback((next: Camera) => {
    pendingRef.current = next;
    notifyNavigated();
    if (rAFRef.current === null) {
      rAFRef.current = requestAnimationFrame(() => {
        rAFRef.current = null;
        const p = pendingRef.current;
        pendingRef.current = null;
        if (p) {
          setCamera(p);
        }
      });
    }
  }, [notifyNavigated]);

  // Exposed handlers
  const beginPan = useCallback(
    (p: Point) => {
      isPanningRef.current = true;
    },
    [],
  );

  const panMove = useCallback(
    (deltaX: number, deltaY: number) => {
      if (!isPanningRef.current) return;
      const next = panBy(camera, deltaX, deltaY);
      if (next !== camera) {
        scheduleUpdate(next);
      }
    },
    [camera, scheduleUpdate],
  );

  const endPan = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  const wheel = useCallback(
    (deltaX: number, deltaY: number, ctrlOrMeta: boolean, point: Point) => {
      if (ctrlOrMeta) {
        const factor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY);
        const next = zoomAt(camera, point, factor);
        if (next !== camera) {
          scheduleUpdate(next);
        }
      } else {
        // Plain scroll: pan by negative of scroll delta
        const next = panBy(camera, -deltaX, -deltaY);
        if (next !== camera) {
          scheduleUpdate(next);
        }
      }
    },
    [camera, scheduleUpdate],
  );

  const zoomIn = useCallback(() => {
    const next = zoomStep(camera, viewport, 'in');
    if (next !== camera) {
      scheduleUpdate(next);
    }
  }, [camera, viewport, scheduleUpdate]);

  const zoomOut = useCallback(() => {
    const next = zoomStep(camera, viewport, 'out');
    if (next !== camera) {
      scheduleUpdate(next);
    }
  }, [camera, viewport, scheduleUpdate]);

  const reset = useCallback(() => {
    const next = resetCameraMath(viewport);
    if (next !== camera) {
      scheduleUpdate(next);
    } else {
      // Still notify navigated even if reset produces same object (e.g., already at default)
      notifyNavigated();
    }
  }, [camera, viewport, scheduleUpdate, notifyNavigated]);

  // Gesture-based zoom (Safari pinch)
  const gestureZoom = useCallback(
    (scale: number, point: Point) => {
      if (!Number.isFinite(scale) || scale <= 0) return;
      const next = zoomAt(camera, point, scale);
      if (next !== camera) {
        scheduleUpdate(next);
      }
    },
    [camera, scheduleUpdate],
  );

  const hasNextNavigation = !hasNavigatedRef.current;
  const percent = zoomPercent(camera);
  const zIn = canZoomIn(camera);
  const zOut = canZoomOut(camera);

  // Imperative setter exposed for test hooks (window.__vidi6.setCamera)
  const setRawCamera = useCallback((c: Camera) => {
    notifyNavigated();
    pendingRef.current = c;
    if (rAFRef.current === null) {
      rAFRef.current = requestAnimationFrame(() => {
        rAFRef.current = null;
        const p = pendingRef.current;
        pendingRef.current = null;
        if (p) {
          setCamera(p);
        }
      });
    }
  }, [notifyNavigated]);

  return {
    camera,
    hasNavigated: hasNextNavigation,
    percent,
    canZoomIn: zIn,
    canZoomOut: zOut,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomIn,
    zoomOut,
    reset,
    gestureZoom,
    setRawCamera,
  };
}
