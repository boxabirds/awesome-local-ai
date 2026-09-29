/**
 * Drop highlight overlay (story 12, image.drop).
 *
 * A dashed outline that appears over the board area while files are
 * being dragged over it. Rendered as a fixed-position div with a dashed
 * border, pointer-events: none so it never intercepts the drop.
 */

import type { JSX } from 'react';

export function DropHighlight(): JSX.Element {
  return (
    <div
      className="vidi6-drop-highlight"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        border: '3px dashed #4285F4',
        borderRadius: '4px',
        background: 'rgba(66, 133, 244, 0.05)',
      }}
    />
  );
}
