/**
 * Story 12 (image.drop): the dashed outline shown over the board area while
 * files are dragged over it (dragenter … dragleave/drop, file drags only).
 */
import type { ReactElement } from 'react';

export function DropHighlight({ active }: { active: boolean }): ReactElement | null {
  if (!active) return null;
  return (
    <div
      data-drop-highlight="true"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 8,
        border: '2px dashed #1a73e8',
        borderRadius: 12,
        background: 'rgba(26, 115, 232, 0.06)',
        pointerEvents: 'none',
        zIndex: 30,
      }}
    />
  );
}
