import { useEffect, useRef } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Bottom-right zoom control: − , percentage, +, Reset view.
 *
 * Stateless and presentational: it renders the camera-derived props and calls
 * back. The `disabled` attribute keeps the button that would exceed a zoom limit
 * out of reach (and out of the keyboard). The percentage lives in an
 * `aria-live="polite"` element so screen readers announce zoom changes.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Wheel over the controls is the page's business, not the board's: stop it
  // propagating so Ctrl/Cmd + scroll here never zooms the board.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const stop = (event: Event) => {
      event.stopPropagation();
    };
    el.addEventListener('wheel', stop, { passive: true });
    return () => {
      el.removeEventListener('wheel', stop);
    };
  }, []);

  return (
    <div className="zoom-controls" data-testid="zoom-controls" ref={containerRef}>
      <button
        aria-label="Zoom out"
        data-testid="zoom-out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        type="button"
      >
        −
      </button>
      <output aria-live="polite" className="zoom-label" data-testid="zoom-label">
        {zoomPercent}%
      </output>
      <button
        aria-label="Zoom in"
        data-testid="zoom-in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        type="button"
      >
        +
      </button>
      <button className="zoom-reset" data-testid="reset-view" onClick={onReset} type="button">
        Reset view
      </button>
    </div>
  );
}
