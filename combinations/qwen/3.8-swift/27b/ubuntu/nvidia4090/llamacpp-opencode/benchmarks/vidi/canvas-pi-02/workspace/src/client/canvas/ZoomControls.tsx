// Stateless bottom-right zoom control: − / % / + / Reset view.

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

import type { ReactElement } from 'react';

export function ZoomControls(props: ZoomControlsProps): ReactElement {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } = props;
  return (
    <div
      className="zoom-controls"
      data-testid="zoom-controls"
      // Never let a Ctrl/Cmd wheel over the controls reach the board (TC-30);
      // the browser default is intentionally left unsuppressed here.
      onWheel={(e) => e.stopPropagation()}
    >
      <button type="button" className="zoom-step" aria-label="Zoom out" disabled={!canZoomOut} onClick={onZoomOut}>
        −
      </button>
      <output className="zoom-label" data-testid="zoom-label" aria-live="polite">
        {zoomPercent}%
      </output>
      <button type="button" className="zoom-step" aria-label="Zoom in" disabled={!canZoomIn} onClick={onZoomIn}>
        +
      </button>
      <button type="button" className="zoom-reset" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
