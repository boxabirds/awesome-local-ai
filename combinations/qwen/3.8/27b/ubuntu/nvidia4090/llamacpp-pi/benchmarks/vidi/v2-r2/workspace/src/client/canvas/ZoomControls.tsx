import { type JSX, type WheelEvent as ReactWheelEvent } from 'react';

export interface ZoomControlsProps {
  /** Whole-number percentage shown in the label, e.g. 150 for "150%". */
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Bottom-right zoom control: − / percentage / + / Reset view.
 *
 * Presentational: all camera state comes from props. Disabled buttons cannot
 * be clicked (native `disabled`), and wheel events are stopped so a
 * Ctrl/Cmd-wheel over the controls never reaches the board.
 */
export function ZoomControls(props: ZoomControlsProps): JSX.Element {
  const stopWheelPropagation = (e: ReactWheelEvent): void => {
    e.stopPropagation();
  };

  // Native `disabled` stops real user clicks; the guards keep the contract
  // ("call callbacks only when enabled") true even under synthetic events.
  const handleZoomIn = (): void => {
    if (props.canZoomIn) {
      props.onZoomIn();
    }
  };
  const handleZoomOut = (): void => {
    if (props.canZoomOut) {
      props.onZoomOut();
    }
  };

  return (
    <div
      data-testid="zoom-controls"
      onWheel={stopWheelPropagation}
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        background: 'rgba(255, 255, 255, 0.94)',
        border: '1px solid #d9d9d0',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.12)',
        userSelect: 'none',
      }}
    >
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom out"
        title="Zoom out"
        disabled={!props.canZoomOut}
        onClick={handleZoomOut}
      >
        −
      </button>
      <output
        data-testid="zoom-label"
        aria-live="polite"
        style={{
          minWidth: 52,
          textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {props.zoomPercent}%
      </output>
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom in"
        title="Zoom in"
        disabled={!props.canZoomIn}
        onClick={handleZoomIn}
      >
        +
      </button>
      <button type="button" className="zoom-button" onClick={props.onReset}>
        Reset view
      </button>
    </div>
  );
}
