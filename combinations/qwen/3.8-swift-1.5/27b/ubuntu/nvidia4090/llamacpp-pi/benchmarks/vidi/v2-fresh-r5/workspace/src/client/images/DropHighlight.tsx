/**
 * Dashed drop highlight overlay shown while files are dragged over the board (story 12).
 */
import type { JSX } from 'react';

export function DropHighlight({ visible }: { visible: boolean }): JSX.Element | null {
  if (!visible) return null;

  return (
    <div
      data-testid="drop-highlight"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: '12px',
        border: '3px dashed #1a73e8',
        borderRadius: '8px',
        background: 'rgba(26, 115, 232, 0.05)',
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    />
  );
}
