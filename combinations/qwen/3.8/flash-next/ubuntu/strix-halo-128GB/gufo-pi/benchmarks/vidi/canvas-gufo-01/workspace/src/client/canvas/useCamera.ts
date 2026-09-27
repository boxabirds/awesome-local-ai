// Camera state with the three input paths merged (wheel, buttons/keys, gestures
// handled by the viewport). Story 1; story 5 leaves it untouched.

import { useCallback, useState } from 'react';
import { ZOOM_STEP_FACTOR } from '../../shared/config';
import {
  IDENTITY_CAMERA,
  panBy as panByMath,
  screenToWorld,
  zoomAt as zoomAtMath,
  type Camera,
  type Point,
} from './camera';

export interface CameraController {
  camera: Camera;
  panBy: (dx: number, dy: number) => void;
  zoomAt: (sx: number, sy: number, factor: number) => void;
  zoomStep: (viewport: { width: number; height: number }, direction: 1 | -1) => void;
  resetZoom: (viewport: { width: number; height: number }) => void;
  setCamera: (camera: Camera) => void;
  screenToWorld: (sx: number, sy: number) => Point;
}

export function useCamera(initial: Camera = IDENTITY_CAMERA): CameraController {
  const [camera, setCamera] = useState<Camera>(initial);

  const panBy = useCallback((dx: number, dy: number) => {
    setCamera((cam) => panByMath(cam, dx, dy));
  }, []);

  const zoomAt = useCallback((sx: number, sy: number, factor: number) => {
    setCamera((cam) => zoomAtMath(cam, sx, sy, factor));
  }, []);

  const zoomStep = useCallback((viewport: { width: number; height: number }, direction: 1 | -1) => {
    setCamera((cam) =>
      zoomAtMath(cam, viewport.width / 2, viewport.height / 2, direction > 0 ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR),
    );
  }, []);

  const resetZoom = useCallback((viewport: { width: number; height: number }) => {
    setCamera((cam) => zoomAtMath(cam, viewport.width / 2, viewport.height / 2, 1 / cam.zoom));
  }, []);

  return {
    camera,
    panBy,
    zoomAt,
    zoomStep,
    resetZoom,
    setCamera,
    screenToWorld: (sx: number, sy: number) => screenToWorld(camera, sx, sy),
  };
}
