import React from 'react';

/**
 * Renders a dashed outline over the board area when files are being dragged over it.
 */
export function DropHighlight(): React.JSX.Element {
  return (
    <div
      data-testid="drop-highlight"
      style={{
        position: 'absolute',
        inset: 0,
        border: '3px dashed #1976D2',
        borderRadius: '8px',
        background: 'rgba(25, 118, 210, 0.05)',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    />
  );
}
