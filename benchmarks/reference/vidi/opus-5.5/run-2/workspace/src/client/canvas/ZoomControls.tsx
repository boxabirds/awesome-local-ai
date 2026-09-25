/** Bottom-right zoom control: −, percentage, +, Reset view (anchor: zoom.controls). */
import type { WheelEvent } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

export function ZoomControls(props: ZoomControlsProps): React.JSX.Element {
  // The controls are not board space: a wheel here must never reach the board.
  const stopWheel = (e: WheelEvent) => e.stopPropagation();
  return (
    <div className="zoom-controls" role="group" aria-label="Zoom" data-testid="zoom-controls" onWheel={stopWheel}>
      <button type="button" aria-label="Zoom out" disabled={!props.canZoomOut} onClick={props.onZoomOut}>
        −
      </button>
      <output aria-live="polite" className="zoom-percent" data-testid="zoom-percent">
        {`${props.zoomPercent}%`}
      </output>
      <button type="button" aria-label="Zoom in" disabled={!props.canZoomIn} onClick={props.onZoomIn}>
        +
      </button>
      <button type="button" className="reset-view" onClick={props.onReset}>
        Reset view
      </button>
    </div>
  );
}
