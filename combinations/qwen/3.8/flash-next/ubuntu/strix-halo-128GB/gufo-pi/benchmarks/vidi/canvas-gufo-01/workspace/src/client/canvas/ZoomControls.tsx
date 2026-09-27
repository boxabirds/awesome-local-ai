// Zoom controls: -, percentage (click resets to 100%), +. Keyboard is handled
// by the workspace (story 1: +/-/0).

import { ZOOM_STEP_FACTOR } from '../../shared/config';
import type { CameraController } from './useCamera';

export function ZoomControls({
  controller,
  viewport,
}: {
  controller: CameraController;
  viewport: { width: number; height: number };
}) {
  const percent = Math.round(controller.camera.zoom * 100);
  return (
    <div className="zoom-controls" role="group" aria-label="Zoom controls">
      <button
        type="button"
        className="zoom-out"
        aria-label="Zoom out"
        onClick={() => controller.zoomStep(viewport, -1)}
      >
        −
      </button>
      <button
        type="button"
        className="zoom-percent"
        onClick={() => controller.resetZoom(viewport)}
        title="Reset zoom to 100%"
      >
        {percent}%
      </button>
      <button
        type="button"
        className="zoom-in"
        aria-label="Zoom in"
        onClick={() => controller.zoomStep(viewport, 1)}
      >
        +
      </button>
      <span className="zoom-step-factor" hidden>
        {ZOOM_STEP_FACTOR}
      </span>
    </div>
  );
}
