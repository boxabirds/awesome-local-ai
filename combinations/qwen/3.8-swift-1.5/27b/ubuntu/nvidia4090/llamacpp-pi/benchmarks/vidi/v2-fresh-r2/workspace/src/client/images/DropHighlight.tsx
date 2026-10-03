/**
 * Drag-over highlight (story 12, image.insert).
 *
 * A dashed outline shown over the whole board while a file drag is in
 * progress (between dragenter and dragleave/drop). Purely presentational; the
 * active state is owned by the insert hook.
 */

import type { JSX } from 'react';

/**
 * Render the dashed "drop here" outline when `active`, nothing otherwise.
 */
export function DropHighlight({ active }: { active: boolean }): JSX.Element | null {
  if (!active) return null;
  return (
    <div
      data-testid="drop-highlight"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 1500,
        border: '3px dashed #4a90d9',
        borderRadius: 8,
        backgroundColor: 'rgba(74, 144, 217, 0.08)',
      }}
    />
  );
}
