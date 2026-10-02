/**
 * Zoom controls: zoom out, the current zoom level, zoom in, Reset view.
 *
 * Stateless and presentational: the camera lives in `useCamera`, wired up in
 * `App.tsx`. Buttons are native `button`s with `disabled` set at the zoom
 * limits, so they are keyboard focusable, have accessible names, and a click on
 * a disabled button does nothing at all.
 */
import type { WheelEvent } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

const ZOOM_OUT_LABEL = 'Zoom out';
const ZOOM_IN_LABEL = 'Zoom in';
const RESET_LABEL = 'Reset view';

export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps) {
  // The controls are not the board: a wheel or pinch here is left to the
  // browser, and it must never reach the board's zoom handler either.
  const stopWheelPropagation = (event: WheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  return (
    <div
      className="zoom-controls"
      data-testid="zoom-controls"
      role="group"
      aria-label="Zoom controls"
      onWheel={stopWheelPropagation}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="zoom-controls__button"
        aria-label={ZOOM_OUT_LABEL}
        disabled={!canZoomOut}
        onClick={() => {
          // Belt and braces: a disabled button must never move the camera.
          if (canZoomOut) onZoomOut();
        }}
      >
        &#8722;
      </button>
      <output className="zoom-controls__value" data-testid="zoom-level" aria-live="polite">
        {zoomPercent}%
      </output>
      <button
        type="button"
        className="zoom-controls__button"
        aria-label={ZOOM_IN_LABEL}
        disabled={!canZoomIn}
        onClick={() => {
          if (canZoomIn) onZoomIn();
        }}
      >
        +
      </button>
      <button
        type="button"
        className="zoom-controls__button zoom-controls__button--reset"
        aria-label={RESET_LABEL}
        onClick={onReset}
      >
        {RESET_LABEL}
      </button>
    </div>
  );
}
