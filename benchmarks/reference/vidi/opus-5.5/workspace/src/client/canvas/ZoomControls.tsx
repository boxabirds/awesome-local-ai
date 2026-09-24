import type { WheelEvent as ReactWheelEvent } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/** Wheel over the controls must never reach the board (TC-30). */
function stopWheel(e: ReactWheelEvent) {
  e.stopPropagation();
}

/** Bottom-right zoom control: − / current zoom % / + / Reset view. Stateless. */
export function ZoomControls(props: ZoomControlsProps) {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } = props;
  return (
    <div className="zoom-controls" role="group" aria-label="Zoom" onWheel={stopWheel}>
      <button
        type="button"
        className="zoom-controls__button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={() => {
          if (canZoomOut) onZoomOut();
        }}
      >
        −
      </button>
      <output className="zoom-controls__label" aria-live="polite" aria-label="Zoom level">
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        className="zoom-controls__button"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={() => {
          if (canZoomIn) onZoomIn();
        }}
      >
        +
      </button>
      <button type="button" className="zoom-controls__reset" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
