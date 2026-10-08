import React from 'react'

export interface ZoomControlsProps {
  zoomPercent: number
  canZoomIn: boolean
  canZoomOut: boolean
  onZoomIn(): void
  onZoomOut(): void
  onReset(): void
}

export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps) {
  return (
    <div
      data-testid="zoom-controls"
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.25rem',
        background: 'rgba(255,255,255,0.9)',
        border: '1px solid #ccc',
        borderRadius: 4,
        padding: '0.25rem',
        zIndex: 1000,
      }}
      onWheel={e => {
        // Prevent wheel events from reaching the viewport when over the controls
        e.stopPropagation()
      }}
    >
      <button
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        style={btnStyle}
        data-testid="zoom-out-btn"
      >
        −
      </button>
      <output
        aria-live="polite"
        aria-label="Zoom level"
        style={{
          minWidth: '3.5rem',
          textAlign: 'center',
          fontFamily: 'monospace',
          fontSize: '0.875rem',
          lineHeight: '1.5rem',
        }}
        data-testid="zoom-label"
      >
        {zoomPercent}%
      </output>
      <button
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        style={btnStyle}
        data-testid="zoom-in-btn"
      >
        +
      </button>
      <button
        aria-label="Reset view"
        onClick={onReset}
        style={{ ...btnStyle, padding: '0 0.5rem', width: 'auto' }}
        data-testid="reset-btn"
      >
        Reset view
      </button>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  width: '2rem',
  height: '1.5rem',
  border: '1px solid #ccc',
  borderRadius: 2,
  background: '#fff',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'monospace',
  fontSize: '1rem',
  padding: 0,
}
