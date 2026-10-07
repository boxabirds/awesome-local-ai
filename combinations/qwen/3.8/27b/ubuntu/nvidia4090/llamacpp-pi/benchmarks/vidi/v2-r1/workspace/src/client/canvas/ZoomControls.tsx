// ZoomControls: fixed bottom-right − / % / + / Reset view (story 1).

import type { JSX } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

export function ZoomControls(props: ZoomControlsProps): JSX.Element {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } = props;
  return (
    <div
      className="zoom-controls"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="zoom-controls__button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        −
      </button>
      <output className="zoom-controls__label" aria-live="polite" data-testid="zoom-label">
        {zoomPercent}%
      </output>
      <button
        type="button"
        className="zoom-controls__button"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button type="button" className="zoom-controls__button" aria-label="Reset view" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
