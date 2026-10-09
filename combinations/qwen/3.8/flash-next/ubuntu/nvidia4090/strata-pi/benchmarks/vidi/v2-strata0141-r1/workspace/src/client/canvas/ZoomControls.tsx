export interface ZoomControlsProps {
  readonly zoomPercent: number;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Bottom-right zoom control: Zoom out (−), the zoom percentage, Zoom in (+) and
 * Reset view. Stateless: everything comes from props derived from the camera.
 * Wheel events over the control are not propagated to the board, so Ctrl/Cmd +
 * scroll over it never zooms the board.
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
      data-board-chrome="true"
      onWheel={(e) => {
        e.stopPropagation();
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out"
        disabled={!canZoomOut}
        onClick={() => {
          if (canZoomOut) {
            onZoomOut();
          }
        }}
      >
        &minus;
      </button>
      <output aria-live="polite" data-testid="zoom-percent">
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in"
        disabled={!canZoomIn}
        onClick={() => {
          if (canZoomIn) {
            onZoomIn();
          }
        }}
      >
        +
      </button>
      <button type="button" aria-label="Reset view" title="Reset view" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
