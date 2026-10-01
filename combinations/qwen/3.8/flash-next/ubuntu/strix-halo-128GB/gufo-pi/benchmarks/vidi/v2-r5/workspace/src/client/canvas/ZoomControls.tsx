export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Bottom-right zoom control: − / current percentage / + / Reset view.
 *
 * Stateless and presentational: everything comes from the camera, and every action is a
 * callback. Disabled buttons never fire their callback (native `disabled`, guarded again in
 * the handler), and wheel events do not propagate, so a Ctrl-wheel over the control never
 * zooms the board.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps) {
  const handleZoomOut = () => {
    if (!canZoomOut) return;
    onZoomOut();
  };

  const handleZoomIn = () => {
    if (!canZoomIn) return;
    onZoomIn();
  };

  return (
    <div
      className="zoom-controls"
      data-testid="zoom-controls"
      role="group"
      aria-label="Zoom controls"
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="zoom-step"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={handleZoomOut}
      >
        &minus;
      </button>
      <output className="zoom-percent" data-testid="zoom-percent" aria-live="polite">
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        className="zoom-step"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={handleZoomIn}
      >
        +
      </button>
      <button type="button" className="zoom-reset" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
