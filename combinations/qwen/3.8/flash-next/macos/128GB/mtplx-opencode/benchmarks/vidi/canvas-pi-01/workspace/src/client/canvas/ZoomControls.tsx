/**
 * Story 1 · task 4 — the zoom control (design "zoom.controls").
 *
 * Stateless presentational component: − / percentage / + / Reset view,
 * fixed to the bottom-right of the board area.
 */
import type { MouseEvent, WheelEvent } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/** Minus sign used on the zoom-out button, matching the design's "−". */
const ZOOM_OUT_LABEL = '\u2212';
const ZOOM_IN_LABEL = '+';
const RESET_LABEL = 'Reset view';

export function ZoomControls(props: ZoomControlsProps) {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } = props;

  // Board gestures belong to the board. A wheel (or trackpad pinch, which
  // arrives as a Ctrl+wheel) over the control must not zoom the board: stop
  // the event here so it never reaches the board's wheel listener (TC-30).
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  const click = (handler: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    handler();
  };

  return (
    <div
      className="zoom-controls"
      data-testid="zoom-controls"
      data-zoom-percent={zoomPercent}
      onWheel={onWheel}
    >
      <button
        type="button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={click(onZoomOut)}
      >
        {ZOOM_OUT_LABEL}
      </button>
      <output className="zoom-label" data-testid="zoom-label" aria-live="polite">
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={click(onZoomIn)}
      >
        {ZOOM_IN_LABEL}
      </button>
      <button
        type="button"
        className="zoom-reset"
        aria-label="Reset view"
        onClick={click(onReset)}
      >
        {RESET_LABEL}
      </button>
    </div>
  );
}