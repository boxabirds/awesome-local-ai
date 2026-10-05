/**
 * The zoom control: zoom out, the current zoom level, zoom in and Reset view,
 * fixed to the bottom-right corner of the board area.
 *
 * Stateless — it takes the values it shows and calls back. It is keyboard
 * focusable, gives every button an accessible name, and announces the zoom
 * level politely when it changes.
 */

import type { JSX, WheelEvent } from 'react';

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

  // Ctrl/Cmd + wheel over the control is not a board gesture: keep it away from
  // the board and let the browser do whatever it likes with it.
  const stopWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  return (
    <div
      className="vidi6-zoom-controls"
      data-vidi6="zoom-controls"
      onWheel={stopWheel}
      onWheelCapture={stopWheel}
    >
      <button
        type="button"
        className="vidi6-zoom-step"
        aria-label="Zoom out"
        title="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        {'\u2212'}
      </button>
      <output className="vidi6-zoom-percent" aria-live="polite" data-testid="zoom-percent">
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        className="vidi6-zoom-step"
        aria-label="Zoom in"
        title="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button type="button" className="vidi6-zoom-reset" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
