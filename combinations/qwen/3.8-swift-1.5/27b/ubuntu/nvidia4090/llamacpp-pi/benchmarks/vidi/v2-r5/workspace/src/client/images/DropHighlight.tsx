// src/client/images/DropHighlight.tsx
// Dashed outline over the board while files are dragged over it.

import type { ReactElement } from 'react';

export function DropHighlight(): ReactElement {
  return (
    <div
      data-testid="drop-highlight"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        border: '3px dashed #1E88E5',
        borderRadius: 8,
        background: 'rgba(30, 136, 229, 0.05)',
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    />
  );
}
