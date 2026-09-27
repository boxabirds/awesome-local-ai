// Zoom controls: − / percentage / + / Reset view (see spec: zoom.controls).
// Stateless and presentational; wired to useCamera in App.tsx.

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

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
      data-testid="zoom-controls"
      className="zoom-controls"
      // Stop wheel propagation so Ctrl-wheel over the controls (outside the
      // board) never zooms the board (TC-30).
      onWheel={(event) => event.stopPropagation()}
    >
      <button type="button" aria-label="Zoom out" disabled={!canZoomOut} onClick={onZoomOut}>
        −
      </button>
      <output aria-live="polite" className="zoom-label">
        {zoomPercent}%
      </output>
      <button type="button" aria-label="Zoom in" disabled={!canZoomIn} onClick={onZoomIn}>
        +
      </button>
      <button type="button" className="zoom-reset" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
