import type { WheelEvent } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

const stopWheel = (e: WheelEvent) => e.stopPropagation();

export function ZoomControls(props: ZoomControlsProps) {
  return (
    <div className="zoom-controls" role="group" aria-label="Zoom" onWheel={stopWheel}>
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom out"
        disabled={!props.canZoomOut}
        onClick={props.onZoomOut}
      >
        −
      </button>
      <output className="zoom-label" aria-live="polite">
        {`${props.zoomPercent}%`}
      </output>
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom in"
        disabled={!props.canZoomIn}
        onClick={props.onZoomIn}
      >
        +
      </button>
      <button type="button" className="reset-button" onClick={props.onReset}>
        Reset view
      </button>
    </div>
  );
}
