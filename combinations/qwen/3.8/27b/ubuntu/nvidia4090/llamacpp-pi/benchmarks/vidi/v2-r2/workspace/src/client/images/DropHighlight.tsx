/**
 * Drop highlight overlay (story 12, image.drop).
 *
 * Shows a dashed outline over the board area while files are being
 * dragged over it.
 */

import type { JSX } from 'react';

export function DropHighlight(): JSX.Element {
  return (
    <div
      data-testid="drop-highlight"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 8,
        border: '3px dashed #1a73e8',
        borderRadius: 12,
        background: 'rgba(26, 115, 232, 0.06)',
        pointerEvents: 'none',
        zIndex: 1500,
      }}
    />
  );
}
