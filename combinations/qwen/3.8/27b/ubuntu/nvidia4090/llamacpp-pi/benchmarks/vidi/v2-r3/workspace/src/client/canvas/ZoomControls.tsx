import type { ReactElement } from 'react';
/**
 * Zoom controls, fixed bottom-right: − / % / + / Reset view.
 * Presentational: wired to the camera in App.tsx.
 */
import { canZoomIn, canZoomOut, zoomPercent } from './camera';

export interface ZoomControlsProps {
  zoom: number;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

export function ZoomControls(props: ZoomControlsProps): ReactElement {
  const cam = { zoom: props.zoom, x: 0, y: 0 };
  return (
    <div
      className="zoom-controls"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: '#fff',
        border: '1px solid #d5d9e0',
        borderRadius: 8,
        padding: '6px 10px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        zIndex: 20,
      }}
      // Ctrl/Cmd wheel over the controls must not zoom the board: stop propagation.
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Zoom out"
        disabled={!canZoomOut(cam)}
        onClick={() => {
          if (canZoomOut(cam)) props.onZoomOut();
        }}
      >
        −
      </button>
      <output aria-live="polite" className="zoom-label">
        {zoomPercent(cam)}%
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={!canZoomIn(cam)}
        onClick={() => {
          if (canZoomIn(cam)) props.onZoomIn();
        }}
      >
        +
      </button>
      <button type="button" className="reset-view" onClick={props.onReset}>
        Reset view
      </button>
    </div>
  );
}
