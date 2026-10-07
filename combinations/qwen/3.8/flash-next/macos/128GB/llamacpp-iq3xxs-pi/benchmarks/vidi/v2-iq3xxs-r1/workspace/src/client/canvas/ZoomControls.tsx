export interface ZoomControlsProps {
  readonly zoomPercent: number;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Stateless zoom control (bottom-right). Calls callbacks only via native
 * enabled buttons (disabled buttons never fire onClick). Wheel propagation is
 * stopped so Ctrl/Cmd + wheel over the controls never reaches the board.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps) {
  return (
    <div
      className="zoom-controls"
      data-testid="zoom-controls"
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom out"
        data-testid="zoom-out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        {'\u2212'}
      </button>
      <output className="zoom-label" data-testid="zoom-label" aria-live="polite">
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom in"
        data-testid="zoom-in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
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
