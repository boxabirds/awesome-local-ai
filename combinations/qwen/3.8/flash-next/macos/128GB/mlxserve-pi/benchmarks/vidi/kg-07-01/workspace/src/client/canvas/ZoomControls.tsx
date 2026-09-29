import { useEffect, useRef } from 'react';

export function ZoomControls(props: {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Native listener: keep wheel events over the controls away from the board's wheel handler.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stop);
    return () => el.removeEventListener('wheel', stop);
  }, []);

  return (
    <div ref={ref} className="zoom-controls" role="group" aria-label="Zoom">
      <button
        type="button"
        className="zoom-controls__button"
        aria-label="Zoom out"
        disabled={!props.canZoomOut}
        onClick={props.onZoomOut}
      >
        −
      </button>
      <output className="zoom-controls__label" aria-live="polite">
        {`${props.zoomPercent}%`}
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
      <button type="button" className="zoom-controls__reset" onClick={props.onReset}>
        Reset view
      </button>
    </div>
  );
}
