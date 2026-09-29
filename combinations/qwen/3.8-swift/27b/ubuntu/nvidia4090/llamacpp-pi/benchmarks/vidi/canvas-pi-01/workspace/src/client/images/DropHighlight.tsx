// Drop highlight (see spec: image.drop).
//
// Shown over the whole board while files are being dragged between
// dragenter and dragleave/drop: a dashed outline + hint. Purely visual.

import type { JSX } from 'react';

export function DropHighlight(): JSX.Element {
  return (
    <div
      data-testid="drop-highlight"
      aria-hidden="true"
      className="drop-highlight"
      style={{
        position: 'absolute',
        inset: 8,
        border: '2px dashed #1a73e8',
        borderRadius: 12,
        background: 'rgba(26, 115, 232, 0.06)',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 40,
      }}
    >
      <span
        className="drop-highlight__label"
        style={{
          background: '#1a73e8',
          color: '#fff',
          borderRadius: 8,
          padding: '8px 16px',
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Drop images to add them
      </span>
    </div>
  );
}
