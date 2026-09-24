export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Fixed bottom-right zoom controls: −, percentage label, +, Reset view.
 * Wheel events over the controls stop propagation so Ctrl-wheel there never
 * zooms the board (or the page).
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
    <div className="vidi6-zoom-controls" onWheel={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="vidi6-zoom-button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        −
      </button>
      <output className="vidi6-zoom-label" aria-live="polite">
        {zoomPercent}%
      </output>
      <button
        type="button"
        className="vidi6-zoom-button"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button type="button" className="vidi6-reset-button" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
