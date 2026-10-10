import type { JSX } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Bottom-right zoom control: − , current zoom, +, Reset view.
 * Stateless: everything comes from the camera.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps): JSX.Element {
  return (
    <div
      className="zoom-controls"
      data-vidi6-overlay="zoom-controls"
      data-testid="zoom-controls"
      // Board gestures over the controls belong to the browser, not the board.
      onWheel={(event) => {
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        className="zoom-button zoom-button-out"
        aria-label="Zoom out"
        title="Zoom out (Ctrl/Cmd + −)"
        data-testid="zoom-out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        −
      </button>
      <output
        className="zoom-percent"
        data-testid="zoom-label"
        aria-live="polite"
      >
        {zoomPercent}%
      </output>
      <button
        type="button"
        className="zoom-button zoom-button-in"
        aria-label="Zoom in"
        title="Zoom in (Ctrl/Cmd + =)"
        data-testid="zoom-in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button
        type="button"
        className="zoom-reset"
        title="Reset view (Ctrl/Cmd + 0)"
        data-testid="reset-view"
        onClick={onReset}
      >
        Reset view
      </button>
    </div>
  );
}
