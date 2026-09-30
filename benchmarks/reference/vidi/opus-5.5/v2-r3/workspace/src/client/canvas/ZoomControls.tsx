import type { WheelEvent } from 'react';

export function ZoomControls(props: {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}) {
  // Wheel over the controls must never reach the board (TC-30).
  const stopWheel = (e: WheelEvent) => e.stopPropagation();
  return (
    <div className="zoom-controls" role="group" aria-label="Zoom" onWheel={stopWheel}>
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom out"
        title="Zoom out (Ctrl/Cmd + −)"
        disabled={!props.canZoomOut}
        onClick={props.onZoomOut}
      >
        −
      </button>
      <output className="zoom-label" aria-live="polite" aria-label="Zoom level">
        {`${props.zoomPercent}%`}
      </output>
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom in"
        title="Zoom in (Ctrl/Cmd + =)"
        disabled={!props.canZoomIn}
        onClick={props.onZoomIn}
      >
        +
      </button>
      <button type="button" className="reset-button" title="Reset view (Ctrl/Cmd + 0)" onClick={props.onReset}>
        Reset view
      </button>
    </div>
  );
}
