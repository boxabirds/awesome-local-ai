export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Zoom control cluster (bottom-right): Zoom out, current zoom percentage,
 * Zoom in, and Reset view. A stateless presentational component.
 *
 * Buttons are natively disabled at the zoom limits so they are not clickable
 * or focusable-activatable there. Wheel events over the cluster do not zoom the
 * board (see BoardViewport's control guard, TC-30).
 */
export function ZoomControls(props: ZoomControlsProps) {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } = props;
  return (
    <div
      className="zoom-controls"
      data-zoom-controls=""
      // Wheel over the controls must not pan/zoom the board. We stop propagation
      // but deliberately do NOT preventDefault, so the browser keeps its normal
      // behaviour here (TC-30).
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="zoom-btn"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        {'\u2212'}
      </button>
      <output className="zoom-label" aria-live="polite">
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        className="zoom-btn"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        {'+'}
      </button>
      <button type="button" className="zoom-reset" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
