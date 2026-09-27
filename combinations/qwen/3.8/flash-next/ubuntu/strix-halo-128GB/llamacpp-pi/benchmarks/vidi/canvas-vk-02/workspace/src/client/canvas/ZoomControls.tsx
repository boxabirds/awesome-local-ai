import { useEffect, useRef, type WheelEvent as ReactWheelEvent } from 'react';

export interface ZoomControlsProps {
  /** Current zoom as a whole number, e.g. 150 for "150%". */
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Zoom control: −, the current zoom percentage, + and Reset view, fixed to the
 * bottom-right of the board. Presentational only; all state lives in the
 * camera. Buttons are native, so a disabled button cannot be clicked or
 * focused, and each one has an accessible name.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Wheel gestures over the control belong to the control (and the browser),
  // never to the board behind it: stop the native wheel event from reaching
  // the board's non-passive listener. The browser default is left alone.
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    const stop = (event: WheelEvent) => {
      event.stopPropagation();
    };
    element.addEventListener('wheel', stop, { passive: true });
    return () => element.removeEventListener('wheel', stop);
  }, []);

  const ignoreWheel = (_event: ReactWheelEvent<HTMLDivElement>) => {
    // Handled by the native listener above; kept so React never adds a
    // passive-listener warning for this element.
  };

  return (
    <div
      ref={containerRef}
      className="zoom-controls"
      role="group"
      aria-label="Zoom"
      data-testid="zoom-controls"
      onWheel={ignoreWheel}
    >
      <button type="button" aria-label="Zoom out" title="Zoom out" disabled={!canZoomOut} onClick={onZoomOut}>
        &#8722;
      </button>
      <output
        className="zoom-percent"
        data-testid="zoom-label"
        aria-label="Zoom level"
        aria-live="polite"
        aria-atomic="true"
      >
        {`${zoomPercent}%`}
      </output>
      <button type="button" aria-label="Zoom in" title="Zoom in" disabled={!canZoomIn} onClick={onZoomIn}>
        +
      </button>
      <button type="button" className="zoom-reset" aria-label="Reset view" title="Reset view" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
