import type { ReactElement } from 'react';

/**
 * Dashed outline overlay shown while files are being dragged over the board.
 */
export function DropHighlight(): ReactElement {
  return (
    <div
      data-testid="drop-highlight"
      style={{
        position: 'absolute',
        inset: 0,
        border: '3px dashed #3b82f6',
        borderRadius: 8,
        background: 'rgba(59, 130, 246, 0.05)',
        pointerEvents: 'none',
        zIndex: 100,
      }}
      aria-hidden="true"
    />
  );
}
