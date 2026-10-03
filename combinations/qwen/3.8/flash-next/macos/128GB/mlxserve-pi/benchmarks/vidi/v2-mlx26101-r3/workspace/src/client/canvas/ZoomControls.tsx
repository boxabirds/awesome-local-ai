import { useEffect, useRef } from 'react';
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
 * Zoom control in the bottom-right corner: zoom out, the current zoom level as a
 * whole-number percentage, zoom in and Reset view. Presentational only - all state
 * lives in the camera.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Gestures over the control belong to the control: they must not reach the board.
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) {
      return;
    }
    const stop = (event: WheelEvent): void => {
      event.stopPropagation();
    };
    element.addEventListener('wheel', stop);
    return () => {
      element.removeEventListener('wheel', stop);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="zoom-controls"
      data-board-ui=""
      data-testid="zoom-controls"
      role="group"
      aria-label="Zoom controls"
    >
      <button
        type="button"
        className="zoom-controls__out"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={() => {
          if (canZoomOut) {
            onZoomOut();
          }
        }}
      >
        &#8722;
      </button>
      <output
        className="zoom-controls__percent"
        data-testid="zoom-percent"
        aria-live="polite"
        aria-label="Zoom level"
      >
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        className="zoom-controls__in"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={() => {
          if (canZoomIn) {
            onZoomIn();
          }
        }}
      >
        +
      </button>
      <button type="button" className="zoom-controls__reset" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
