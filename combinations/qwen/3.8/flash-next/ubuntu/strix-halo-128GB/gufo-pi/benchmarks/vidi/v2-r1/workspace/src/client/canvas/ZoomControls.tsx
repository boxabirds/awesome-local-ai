import type { WheelEvent as ReactWheelEvent } from 'react';

export interface ZoomControlsProps {
  /** Whole-number zoom percentage to display, e.g. 125. */
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Bottom-right zoom control: −, the current zoom percentage, +, and Reset view.
 * Stateless and presentational; the callbacks come from `useCamera`.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps) {
  // The buttons are also `disabled`, but a click delivered programmatically (or
  // by a helper that does not go through the browser's click suppression) must
  // still not move the camera past a limit.
  const zoomIn = () => {
    if (canZoomIn) onZoomIn();
  };
  const zoomOut = () => {
    if (canZoomOut) onZoomOut();
  };

  return (
    <div
      className="zoom-controls"
      data-testid="zoom-controls"
      // The controls are chrome, not board: a wheel (or a pinch, which arrives as
      // a Ctrl/Cmd wheel) here must never zoom the board. The browser default is
      // left alone so the page can still zoom over the panel.
      onWheel={(event: ReactWheelEvent<HTMLDivElement>) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Zoom out"
        data-testid="zoom-out"
        disabled={!canZoomOut}
        onClick={zoomOut}
      >
        &minus;
      </button>
      <output
        className="zoom-controls__label"
        aria-live="polite"
        data-testid="zoom-label"
      >{`${zoomPercent}%`}</output>
      <button
        type="button"
        aria-label="Zoom in"
        data-testid="zoom-in"
        disabled={!canZoomIn}
        onClick={zoomIn}
      >
        +
      </button>
      <button
        type="button"
        className="zoom-controls__reset"
        data-testid="reset-view"
        onClick={onReset}
      >
        Reset view
      </button>
    </div>
  );
}
