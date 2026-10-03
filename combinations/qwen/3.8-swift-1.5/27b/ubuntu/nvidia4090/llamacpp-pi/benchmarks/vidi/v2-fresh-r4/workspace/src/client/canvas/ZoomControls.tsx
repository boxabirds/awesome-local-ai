import type { JSX } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Bottom-right zoom control: −, whole-number percentage, +, Reset view.
 * Stateless and presentational; wired to useCamera in App.tsx.
 */
export function ZoomControls(props: ZoomControlsProps): JSX.Element {
  return (
    <div
      className="zoom-controls"
      data-vidi6="zoom-controls"
      // Keep Ctrl/Cmd+wheel over the controls out of the board's wheel path
      // (the board listener is not an ancestor, but be explicit).
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="zoom-out"
        aria-label="Zoom out"
        disabled={!props.canZoomOut}
        onClick={props.onZoomOut}
      >
        −
      </button>
      <output className="zoom-label" aria-live="polite" data-vidi6="zoom-label">
        {props.zoomPercent}%
      </output>
      <button
        type="button"
        className="zoom-in"
        aria-label="Zoom in"
        disabled={!props.canZoomIn}
        onClick={props.onZoomIn}
      >
        +
      </button>
      <button type="button" className="reset-view" aria-label="Reset view" onClick={props.onReset}>
        Reset view
      </button>
    </div>
  );
}
