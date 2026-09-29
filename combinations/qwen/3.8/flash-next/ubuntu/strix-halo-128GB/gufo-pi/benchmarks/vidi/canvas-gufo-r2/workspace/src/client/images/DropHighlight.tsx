/**
 * The dashed outline shown while image files are dragged over the board
 * (story 12, image.drop). Purely presentational: `useImageInsert` decides when it
 * is visible, and the outline never swallows the drop itself.
 */
import type { JSX } from 'react';

export function DropHighlight({ visible }: { visible: boolean }): JSX.Element | null {
  if (!visible) return null;
  return (
    <div
      className="drop-highlight"
      data-testid="drop-highlight"
      aria-hidden="true"
    >
      <span className="drop-highlight-label">Drop images to add them</span>
    </div>
  );
}
