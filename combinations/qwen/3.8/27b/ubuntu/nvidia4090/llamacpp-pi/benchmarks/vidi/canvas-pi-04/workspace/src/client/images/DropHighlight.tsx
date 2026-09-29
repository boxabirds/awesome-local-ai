// Story 12: the drag-over drop highlight (anchor: image.drop).
//
// A full-board outline shown while files are dragged over the board, signalling
// that images can be dropped. It is purely presentational (pointer-events none)
// and hidden unless `active`.

import type { JSX } from 'react';

export function DropHighlight({ active }: { active: boolean }): JSX.Element | null {
  if (!active) return null;
  return (
    <div className="drop-highlight" data-testid="drop-highlight" aria-hidden="true">
      <div className="drop-highlight__label">Drop images to add them</div>
    </div>
  );
}
