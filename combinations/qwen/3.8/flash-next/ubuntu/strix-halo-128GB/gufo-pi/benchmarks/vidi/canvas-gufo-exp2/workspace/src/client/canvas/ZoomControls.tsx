import { useEffect, useRef, type WheelEvent as ReactWheelEvent } from 'react';

export interface ZoomControlsProps {
  /** Current zoom as a whole number, e.g. 150. */
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Bottom-right zoom control: − , current zoom, +, Reset view.
 * Stateless; everything comes from props.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Zoom gestures over the control belong to the control: stop them reaching
  // the board (the board's own Ctrl+wheel handler must not fire).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
    };
    container.addEventListener('wheel', onWheel, { passive: true });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  const stopWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

  return (
    <div
      ref={containerRef}
      className="zoom-controls"
      data-testid="zoom-controls"
      role="group"
      aria-label="Zoom controls"
      onWheel={stopWheel}
      onWheelCapture={stopWheel}
    >
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom out"
        data-testid="zoom-out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        &minus;
      </button>
      <output
        className="zoom-label"
        data-testid="zoom-label"
        aria-live="polite"
        aria-label="Zoom level"
      >
        {zoomPercent}%
      </output>
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom in"
        data-testid="zoom-in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button
        type="button"
        className="reset-button"
        data-testid="reset-view"
        onClick={onReset}
      >
        Reset view
      </button>
    </div>
  );
}
