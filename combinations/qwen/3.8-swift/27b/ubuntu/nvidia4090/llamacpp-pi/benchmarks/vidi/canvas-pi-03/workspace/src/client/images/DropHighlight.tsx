/**
 * Story 12: the dashed drop highlight (image.drop).
 *
 * A fixed inset-0 overlay shown while files drag over the board: a dashed
 * outline and a centred "Drop images to add them" hint. Purely visual
 * (pointer-events: none) so the drop lands on the viewport.
 */
import type { JSX } from 'react';

export function DropHighlight(): JSX.Element {
  return (
    <div
      data-testid="drop-highlight"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 12,
        border: '3px dashed #1A73E8',
        borderRadius: 12,
        backgroundColor: 'rgba(26, 115, 232, 0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1500,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          padding: '10px 18px',
          backgroundColor: '#ffffff',
          border: '1px solid #1A73E8',
          borderRadius: 8,
          color: '#1A73E8',
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Drop images to add them
      </div>
    </div>
  );
}
