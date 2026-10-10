import { useEffect, useRef } from 'react';
import type { JSX } from 'react';

export interface ZoomControlsProps {
  /** Current zoom as a whole number, e.g. 150. */
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/** Typographic minus, as shown on the zoom-out button. */
const MINUS_SIGN = '−';
const PLUS_SIGN = '+';
const PERCENT_SIGN = '%';
export const ZOOM_OUT_LABEL = 'Zoom out';
export const ZOOM_IN_LABEL = 'Zoom in';
export const RESET_VIEW_LABEL = 'Reset view';

/**
 * Zoom chrome: − , percentage, + and Reset view (bottom-right).
 *
 * Stateless and presentational: everything comes from props.
 *
 * The wheel listener stops propagation so a Ctrl/Cmd-wheel that starts on the
 * control cannot reach the board behind it and cannot zoom the board. The
 * browser default is deliberately left alone (design `viewport.input` /
 * TC-30): the control is chrome, not the board, and the PRD only promises that
 * gestures *over the board* never zoom the page.
 */
export function ZoomControls(props: ZoomControlsProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      event.stopPropagation();
    };
    container.addEventListener('wheel', onWheel, { passive: true });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="zoom-controls" data-testid="zoom-controls" ref={containerRef}>
      <button
        type="button"
        aria-label={ZOOM_OUT_LABEL}
        data-testid="zoom-out"
        disabled={!props.canZoomOut}
        onClick={props.onZoomOut}
      >
        {MINUS_SIGN}
      </button>
      <output
        className="zoom-percent"
        data-testid="zoom-percent"
        aria-live="polite"
      >
        {`${props.zoomPercent}${PERCENT_SIGN}`}
      </output>
      <button
        type="button"
        aria-label={ZOOM_IN_LABEL}
        data-testid="zoom-in"
        disabled={!props.canZoomIn}
        onClick={props.onZoomIn}
      >
        {PLUS_SIGN}
      </button>
      <button type="button" data-testid="reset-view" onClick={props.onReset}>
        {RESET_VIEW_LABEL}
      </button>
    </div>
  );
}
