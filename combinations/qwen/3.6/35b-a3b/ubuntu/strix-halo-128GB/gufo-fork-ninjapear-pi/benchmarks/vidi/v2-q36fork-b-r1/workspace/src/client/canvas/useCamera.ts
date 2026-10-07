import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, Point, Size } from './camera';
import { getTestOverride, setTestOverride } from './testCameraStore';
import {
  panBy,
  zoomAt as zoomAtMath,
  zoomStep as zoomStepMath,
  resetCamera as resetCameraMath,
} from './camera';

// LINE and PAGE scroll mode to pixel conversion constants
const LINE_TO_PIXEL = 3; // approximate pixels per line scroll
const PAGE_TO_PIXEL = 50; // approximate pixels per page scroll

export function useCamera(viewport: Size): {
  camera: Camera;
  hasNavigated: boolean;
  beginPan: (p: Point) => void;
  panMove: (p: Point) => void;
  endPan: () => void;
  wheel: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  zoomAt: (screenPoint: Point, factor: number) => void;
  zoomStep: (dir: 'in' | 'out') => void;
  reset: () => void;
} {
  const [cameraState, setCameraState] = useState<Camera>({ x: viewport.width / 2, y: viewport.height / 2, zoom: 1 });

  // --- External camera store for test-mode overrides ---
  const extCamRef = useRef<{ cam: Camera | null }>({ cam: null });

  // Register __vidi6.setCamera once
  useEffect(() => {
    if (import.meta.env?.MODE === 'test' && typeof window !== 'undefined') {
      const existing = window.__vidi6 as Record<string, unknown> | undefined;
      window.__vidi6 = {
        ...(existing ? { ...existing } : {}),
        setCamera: (cam: Record<string, any>) => {
          extCamRef.current.cam = { x: cam.x, y: cam.y, zoom: cam.zoom };
          setCameraState(extCamRef.current.cam);
        },
      };
    }
    return () => { /* keep listener for entire session */ };
  }, []);

  // Read external camera ref each render and apply immediately.
  // Clear extCamRef after applying so one-shot override doesn't linger.
  const extCam = extCamRef.current.cam;
  if (extCam) {
    extCamRef.current.cam = null; // consume the override
    setCameraState(extCam);
  }

  // The single source of truth for reading current camera in handlers
  const cameraRef = useRef(cameraState);
  cameraRef.current = cameraState;

  // Interaction state (ref-backed so the handler closures always see current values)
  const isPanningRef = useRef(false);
  const panStartCamera = useRef<Camera>({ x: 0, y: 0, zoom: 0 });
  const panStartPoint = useRef<Point>({ x: 0, y: 0 });

  // hasNavigated latch — set once when a real camera change occurs, never resets
  const hasNavigatedRef = useRef(false);

  // rAF batch id to avoid multiple setState calls in one frame
  const rafbIdRef = useRef<number | null>(null);
  const pendingCameraRef = useRef<Camera | null>(null);

  const flushPending = useCallback(() => {
    if (pendingCameraRef.current) {
      setCameraState(pendingCameraRef.current);
      pendingCameraRef.current = null;
    }
  }, []);

  const scheduleUpdate = useCallback(
    (next: Camera) => {
      // Only trigger navigation latch when we get a new object different from what
      // the handler saw when it started processing
      if (!hasNavigatedRef.current && next !== cameraRef.current) {
        hasNavigatedRef.current = true;
      }
      if (rafbIdRef.current !== null) {
        cancelAnimationFrame(rafbIdRef.current);
      }
      pendingCameraRef.current = next;
      rafbIdRef.current = requestAnimationFrame(flushPending);
    },
    [flushPending],
  );

  // Pan by dragging
  const beginPan = useCallback((p: Point) => {
    isPanningRef.current = true;
    panStartCamera.current = cameraRef.current;
    panStartPoint.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      if (!isPanningRef.current) return;
      const dx = p.x - panStartPoint.current.x;
      const dy = p.y - panStartPoint.current.y;
      if (dx === 0 && dy === 0) return;
      const next = panBy(panStartCamera.current, dx, dy);
      scheduleUpdate(next);
    },
    [scheduleUpdate],
  );

  const endPan = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  // Wheel: plain scroll pans, Ctrl/Cmd scroll zooms
  const wheel = useCallback(
    ({ deltaX, deltaY, ctrlOrMeta, point }: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
      const cam = cameraRef.current;
      if (ctrlOrMeta) {
        // Zoom around pointer
        const factor = Math.exp(-deltaY * 0.01);
        const next = zoomAtMath(cam, point, factor);
        if (next !== cam) {
          scheduleUpdate(next);
        }
      } else {
        // Plain scroll: pan the board in the scroll direction
        const pdx = -deltaX;
        const pdy = -deltaY;
        if (pdx === 0 && pdy === 0) return;
        const next = panBy(cam, pdx, pdy);
        if (next !== cam) {
          scheduleUpdate(next);
        }
      }
    },
    [scheduleUpdate],
  );

  // Zoom at a specific screen point (used by gesture events)
  const zoomAt = useCallback(
    (screenPoint: Point, factor: number) => {
      const cam = cameraRef.current;
      const next = zoomAtMath(cam, screenPoint, factor);
      if (next !== cam) {
        scheduleUpdate(next);
      }
    },
    [scheduleUpdate],
  );

  // Step zoom around viewport centre
  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      const next = zoomStepMath(cameraRef.current, viewport, dir);
      if (next !== cameraRef.current) {
        scheduleUpdate(next);
      }
    },
    [viewport, scheduleUpdate],
  );

  // Reset view
  const reset = useCallback(() => {
    const next = resetCameraMath(viewport);
    if (next !== cameraRef.current) {
      scheduleUpdate(next);
    }
  }, [viewport, scheduleUpdate]);

  return {
    camera: cameraState,
    hasNavigated: hasNavigatedRef.current,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAt,
    zoomStep,
    reset,
  };
}
