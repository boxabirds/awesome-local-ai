// Zoom controls: −, current zoom, +, Reset view (design "Zoom controls").
// Stateless and presentational: everything comes from props.
import type { JSX } from "react";
import { useEffect, useRef } from "react";

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

export function ZoomControls(props: ZoomControlsProps): JSX.Element {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } =
    props;
  const rootRef = useRef<HTMLDivElement | null>(null);

  // The board owns wheel gestures over itself; the controls are not the board, so a
  // Ctrl/Cmd + wheel here must never zoom the board (and must not have its browser
  // default suppressed). The board's wheel listener is non-passive and attached to
  // an ancestor, so stop propagation with a native listener on this element.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (event: WheelEvent) => {
      event.stopPropagation();
    };
    el.addEventListener("wheel", stop, { passive: true });
    return () => el.removeEventListener("wheel", stop);
  }, []);

  return (
    <div
      className="vidi6-zoom-controls"
      data-board-part="zoom-controls"
      ref={rootRef}
    >
      <button
        type="button"
        className="vidi6-zoom-button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        {"\u2212"}
      </button>
      <output
        className="vidi6-zoom-percent"
        data-testid="zoom-percent"
        aria-live="polite"
      >
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        className="vidi6-zoom-button"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button type="button" className="vidi6-reset-button" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
