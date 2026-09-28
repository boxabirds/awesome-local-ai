import { useEffect, useRef, type ReactElement } from 'react';

/**
 * Bottom-right zoom control: − , current zoom, + , Reset view.
 * Stateless: all values come from the camera, all actions are callbacks.
 */
export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    // The board's wheel listener lives on an ancestor, so a wheel that starts on
    // this control is stopped here (TC-30: the board must not zoom) and its
    // default is suppressed here as well (negative test: the browser page zoom
    // must not change either). React registers `wheel` passively, so this has to
    // be a native non-passive listener.
    const onWheel = (event: WheelEvent) => {
      event.stopPropagation();
      event.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={rootRef}
      className="zoom-controls"
      data-testid="zoom-controls"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={() => {
          if (canZoomOut) onZoomOut();
        }}
      >
        &minus;
      </button>
      <output className="zoom-percent" data-testid="zoom-percent" aria-live="polite">
        {zoomPercent}%
      </output>
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={() => {
          if (canZoomIn) onZoomIn();
        }}
      >
        +
      </button>
      <button type="button" className="zoom-reset" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
