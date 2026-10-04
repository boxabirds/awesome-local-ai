import type { JSX, CSSProperties, WheelEvent as ReactWheelEvent } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Bottom-right zoom control: − / percentage / + / Reset view. Stateless and
 * presentational; the buttons are disabled at the zoom limits so their
 * callbacks are only invoked when the action is allowed.
 *
 * The container stops wheel propagation so a Ctrl/Cmd wheel over the controls
 * never reaches the board (which would zoom it) and leaves the browser default
 * un-suppressed here.
 */
export function ZoomControls(props: ZoomControlsProps): JSX.Element {
  const stopWheel = (e: ReactWheelEvent) => e.stopPropagation();

  return (
    <div
      className="zoom-controls"
      role="group"
      aria-label="Zoom controls"
      onWheel={stopWheel}
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        background: 'rgba(255,255,255,0.9)',
        border: '1px solid #d0d0d0',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        font: '14px/1 system-ui, sans-serif',
      }}
    >
      <button
        type="button"
        aria-label="Zoom out"
        disabled={!props.canZoomOut}
        onClick={props.onZoomOut}
        style={buttonStyle}
      >
        −
      </button>
      <output aria-live="polite" style={labelStyle}>
        {props.zoomPercent}%
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={!props.canZoomIn}
        onClick={props.onZoomIn}
        style={buttonStyle}
      >
        +
      </button>
      <button
        type="button"
        aria-label="Reset view"
        onClick={props.onReset}
        style={{ ...buttonStyle, paddingLeft: 8, paddingRight: 8 }}
      >
        Reset view
      </button>
    </div>
  );
}

const buttonStyle: CSSProperties = {
  width: 28,
  height: 28,
  border: '1px solid #c0c0c0',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  font: '16px/1 system-ui, sans-serif',
};

const labelStyle: CSSProperties = {
  minWidth: 48,
  textAlign: 'center',
  fontVariantNumeric: 'tabular-nums',
};
