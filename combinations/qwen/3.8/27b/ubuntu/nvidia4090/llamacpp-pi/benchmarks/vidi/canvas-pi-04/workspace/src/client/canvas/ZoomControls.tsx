import type { JSX } from 'react';

/**
 * Bottom-right zoom control: −, current zoom percentage, +, Reset view.
 * Stateless and presentational; the App wires it to the camera hook.
 */
export function ZoomControls(props: {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}): JSX.Element {
  return (
    <div
      className="zoom-controls"
      data-testid="zoom-controls"
      // Stop wheel propagation so a Ctrl/Cmd scroll over the controls never
      // reaches the board's zoom handler.
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Zoom out"
        disabled={!props.canZoomOut}
        onClick={props.onZoomOut}
      >
        −
      </button>
      <output aria-live="polite" data-testid="zoom-label">
        {props.zoomPercent}%
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={!props.canZoomIn}
        onClick={props.onZoomIn}
      >
        +
      </button>
      <button type="button" aria-label="Reset view" onClick={props.onReset}>
        Reset view
      </button>
    </div>
  );
}
