import type { JSX } from 'react';

/**
 * The drop highlight (story 12, image.drop): a dashed outline over the board
 * area while files are dragged over it. Purely visual (pointer-events: none).
 */
export function DropHighlight({ visible }: { visible: boolean }): JSX.Element | null {
  if (!visible) return null;
  return (
    <div
      data-testid="drop-highlight"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 8,
        border: '2px dashed #1A73E8',
        borderRadius: 8,
        background: 'rgba(26, 115, 232, 0.08)',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
  );
}
