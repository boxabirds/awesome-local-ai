// DropHighlight (story 12, image.drop): the dashed outline shown while
// image files are dragged over the board.

import type { JSX } from 'react';

export function DropHighlight({ visible }: { visible: boolean }): JSX.Element | null {
  if (!visible) return null;
  return (
    <div className="drop-highlight" data-testid="drop-highlight" aria-hidden="true" />
  );
}
