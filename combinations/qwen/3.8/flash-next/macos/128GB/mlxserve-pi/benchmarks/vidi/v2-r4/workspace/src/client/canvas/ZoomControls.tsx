import { type CSSProperties, type UIEvent } from 'react';

export interface ZoomControlsProps {
  /** Whole-number zoom percentage to show (already rounded). */
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

const containerStyle: CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 16,
};

/**
 * Bottom-right zoom control: − , current zoom, +, Reset view.
 *
 * Stateless and presentational: every value comes from the camera, and a button
 * is disabled rather than hidden at a zoom limit, so the control always shows
 * where the board is and what can still be done.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps) {
  // The control is chrome, not board: a Ctrl/Cmd wheel over it must never zoom
  // the board (and is left to the browser).
  const stopWheel = (event: UIEvent) => event.stopPropagation();

  return (
    <div
      className="zoom-controls"
      data-testid="zoom-controls"
      style={containerStyle}
      onWheel={stopWheel}
      onWheelCapture={stopWheel}
    >
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom out"
        title="Zoom out (Ctrl/Cmd −)"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        −
      </button>
      <output className="zoom-percent" data-testid="zoom-percent" aria-live="polite">
        {zoomPercent}%
      </output>
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom in"
        title="Zoom in (Ctrl/Cmd =)"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button type="button" className="reset-view" data-testid="reset-view" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
