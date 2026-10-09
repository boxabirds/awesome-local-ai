/**
 * Zoom controls, fixed bottom-right: zoom-out (−), current zoom percentage,
 * zoom-in (+) and Reset view.
 *
 * Stateless/presentational: the camera-derived values arrive as props and
 * user actions are reported through callbacks. Buttons are natively disabled
 * at the zoom limits (clicking a disabled button does nothing). The container
 * stops wheel propagation so a Ctrl-wheel over the controls never zooms the
 * board (and never suppresses the browser default there).
 */
import type { SyntheticEvent, WheelEvent as ReactWheelEvent } from "react";

export interface ZoomControlsProps {
  /** Whole-number zoom percentage for display. */
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

export function ZoomControls(props: ZoomControlsProps) {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } =
    props;

  const stopWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };
  const stopPointer = (event: SyntheticEvent<HTMLDivElement>) => {
    // Keep drags that start on the controls from reaching the board.
    event.stopPropagation();
  };

  return (
    <div
      className="zoom-controls"
      data-testid="zoom-controls"
      onWheel={stopWheel}
      onPointerDown={stopPointer}
    >
      <button
        type="button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        −
      </button>
      <output aria-live="polite" data-testid="zoom-label">
        {zoomPercent}%
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button type="button" aria-label="Reset view" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
