export function ZoomControls(props: {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}) {
  return (
    <div className="zoom-controls" onWheel={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Zoom out" disabled={!props.canZoomOut} onClick={props.onZoomOut}>
        −
      </button>
      <output aria-live="polite" data-testid="zoom-label">
        {props.zoomPercent}%
      </output>
      <button type="button" aria-label="Zoom in" disabled={!props.canZoomIn} onClick={props.onZoomIn}>
        +
      </button>
      <button type="button" onClick={props.onReset}>
        Reset view
      </button>
    </div>
  );
}
