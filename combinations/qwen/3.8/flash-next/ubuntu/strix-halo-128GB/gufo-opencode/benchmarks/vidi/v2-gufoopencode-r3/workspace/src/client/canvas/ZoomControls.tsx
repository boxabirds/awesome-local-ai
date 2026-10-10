import type { WheelEvent } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

const MINUS_SIGN = '\u2212';

export function ZoomControls(props: ZoomControlsProps) {
  // Ctrl/Cmd + wheel over the controls must never zoom the board, but the
  // browser default (page zoom) is left alone here (TC-30).
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

  return (
    <div
      className="zoom-controls"
      data-testid="zoom-controls"
      role="group"
      aria-label="Zoom controls"
      onWheel={onWheel}
    >
      <button
        type="button"
        aria-label="Zoom out"
        disabled={!props.canZoomOut}
        onClick={props.onZoomOut}
      >
        {MINUS_SIGN}
      </button>
      <output data-testid="zoom-label" aria-live="polite">
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
      <button type="button" onClick={props.onReset}>
        Reset view
      </button>
    </div>
  );
}
