export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Bottom-right zoom control: −, the current zoom percentage, + and Reset view.
 * Stateless: everything comes from the camera.
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
      role="group"
      aria-label="Zoom controls"
      onWheel={(event) => {
        // A Ctrl/Cmd wheel over the control must never zoom the board.
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        aria-label="Zoom out"
        data-testid="zoom-out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        &#8722;
      </button>
      <output
        className="zoom-label"
        data-testid="zoom-label"
        aria-live="polite"
        aria-label="Zoom level"
      >
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        data-testid="zoom-in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button type="button" aria-label="Reset view" data-testid="zoom-reset" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
