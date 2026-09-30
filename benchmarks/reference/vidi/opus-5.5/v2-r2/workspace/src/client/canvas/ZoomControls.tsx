export function ZoomControls(props: {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}): React.JSX.Element {
  return (
    // Wheel over the controls must never reach the board (TC-30).
    <div className="zoom-controls" role="group" aria-label="Zoom" onWheel={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Zoom out" disabled={!props.canZoomOut} onClick={props.onZoomOut}>
        −
      </button>
      <output className="zoom-controls-label" aria-live="polite">
        {`${props.zoomPercent}%`}
      </output>
      <button type="button" aria-label="Zoom in" disabled={!props.canZoomIn} onClick={props.onZoomIn}>
        +
      </button>
      <button type="button" className="zoom-controls-reset" onClick={props.onReset}>
        Reset view
      </button>
    </div>
  );
}
