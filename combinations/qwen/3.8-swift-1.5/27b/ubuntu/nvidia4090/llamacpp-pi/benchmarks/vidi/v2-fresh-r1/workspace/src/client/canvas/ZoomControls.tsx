// Zoom controls: − / percentage / + / Reset view, fixed bottom-right.

export function ZoomControls(props: {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}) {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } = props;

  return (
    // Wheel over the controls must not reach the board's wheel listener.
    <div className="zoom-controls" onWheel={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Zoom out"
        className="zoom-controls__button"
        disabled={!canZoomOut}
        onClick={canZoomOut ? onZoomOut : undefined}
      >
        −
      </button>
      <output className="zoom-controls__label" aria-live="polite">
        {zoomPercent}%
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        className="zoom-controls__button"
        disabled={!canZoomIn}
        onClick={canZoomIn ? onZoomIn : undefined}
      >
        +
      </button>
      <button type="button" aria-label="Reset view" className="zoom-controls__reset" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
