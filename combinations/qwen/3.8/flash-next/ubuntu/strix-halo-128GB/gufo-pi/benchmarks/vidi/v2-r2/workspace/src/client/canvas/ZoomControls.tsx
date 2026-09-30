import type { ReactElement, WheelEvent } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

// Stateless presentational control, positioned fixed bottom-right by CSS. It only
// reads props and calls callbacks; buttons use the native disabled attribute so
// disabled buttons never fire their callback (TC-32).
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps): ReactElement {
  // Stop wheel propagation so a scroll/pinch over the controls never zooms the
  // board behind them. Browser default is left intact here (TC-30).
  const handleWheel = (e: WheelEvent) => {
    e.stopPropagation();
  };

  return (
    <div className="zoom-controls" data-board-ui data-testid="zoom-controls" onWheel={handleWheel}>
      <button
        type="button"
        aria-label="Zoom out"
        className="zoom-out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        {'\u2212'}
      </button>
      <output aria-live="polite" className="zoom-label" data-testid="zoom-label">
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        className="zoom-in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        {'+'}
      </button>
      <button
        type="button"
        className="zoom-reset"
        data-testid="reset-view"
        onClick={onReset}
      >
        Reset view
      </button>
    </div>
  );
}
