import { useEffect, useRef } from 'react';

/**
 * Zoom controls: minus, current zoom percentage, plus, and Reset view, fixed to
 * the bottom-right corner. Presentational and stateless: it receives the values
 * derived from the camera and calls back.
 */
export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

export function ZoomControls(props: ZoomControlsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Zoom gestures over the controls must never reach the board. The default
    // is left untouched, so browser behaviour here is unchanged (TC-30).
    const onWheel = (event: WheelEvent) => {
      event.stopPropagation();
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={containerRef}
      className="zoom-controls"
      data-testid="zoom-controls"
    >
      <button
        type="button"
        className="zoom-controls__button"
        aria-label="Zoom out"
        disabled={!props.canZoomOut}
        onClick={props.onZoomOut}
      >
        &#8722;
      </button>
      <output
        className="zoom-controls__value"
        data-testid="zoom-label"
        aria-live="polite"
      >
        {props.zoomPercent}%
      </output>
      <button
        type="button"
        className="zoom-controls__button"
        aria-label="Zoom in"
        disabled={!props.canZoomIn}
        onClick={props.onZoomIn}
      >
        +
      </button>
      <button
        type="button"
        className="zoom-controls__reset"
        data-testid="reset-view"
        onClick={props.onReset}
      >
        Reset view
      </button>
    </div>
  );
}
