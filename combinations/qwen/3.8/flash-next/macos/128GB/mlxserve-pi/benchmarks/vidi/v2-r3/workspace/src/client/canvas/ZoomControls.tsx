export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Stateless zoom control fixed to the bottom-right of the board area:
 * − (Zoom out), the current zoom percentage (announced politely), + (Zoom
 * in) and Reset view. Buttons are natively disabled at the zoom limits.
 * Wheel events are stopped here so Ctrl/Cmd + wheel over the control never
 * zooms the board (and the browser default is not suppressed there).
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
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button type="button" aria-label="Zoom out" disabled={!canZoomOut} onClick={onZoomOut}>
        &minus;
      </button>
      <output className="zoom-label" data-testid="zoom-label" aria-live="polite">
        {zoomPercent}%
      </output>
      <button type="button" aria-label="Zoom in" disabled={!canZoomIn} onClick={onZoomIn}>
        +
      </button>
      <button type="button" className="reset-view-button" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
