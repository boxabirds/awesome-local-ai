import type { ReactElement } from 'react';

/**
 * Story 12 — the full-board outline shown while a file drag hovers the board
 * (image.drop). Purely presentational: `active` comes from useImageInsert's
 * drag state. It never intercepts pointer events (pointerEvents none) so the
 * drop still lands on the board underneath.
 */
export function DropHighlight({ active }: { active: boolean }): ReactElement | null {
  if (!active) return null;
  return (
    <div
      data-testid="drop-highlight"
      style={{
        position: 'fixed',
        inset: 12,
        zIndex: 10002,
        pointerEvents: 'none',
        border: '3px dashed rgba(47, 101, 242, 0.8)',
        borderRadius: 14,
        background: 'rgba(47, 101, 242, 0.06)',
      }}
    />
  );
}
