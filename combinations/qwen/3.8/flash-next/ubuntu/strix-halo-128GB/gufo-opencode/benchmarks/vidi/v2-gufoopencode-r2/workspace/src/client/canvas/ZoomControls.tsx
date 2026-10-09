import { useEffect, useRef } from 'react';

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
}: ZoomControlsProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Ctrl-wheel over the controls must never zoom the board (the viewport's
  // wheel listener lives on an ancestor); stop propagation without
  // preventing the browser default here.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stop);
    return () => el.removeEventListener('wheel', stop);
  }, []);

  return (
    <div ref={rootRef} className="zoom-controls" data-testid="zoom-controls">
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        −
      </button>
      <output data-testid="zoom-label" aria-live="polite" className="zoom-label">
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button type="button" className="zoom-reset" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
