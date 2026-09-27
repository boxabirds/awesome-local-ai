import { type JSX } from 'react';

/**
 * The drop highlight (`image.drop`): a dashed outline over the whole board while
 * image files are dragged over it, so the board is visibly the target before the
 * files are let go. Nothing about it is interactive — a drop has to land on the
 * viewport behind it, not on the highlight.
 */
export function DropHighlight(): JSX.Element {
  return (
    <div
      className="board-drop-highlight"
      data-testid="drop-highlight"
      role="presentation"
      aria-hidden="true"
    />
  );
}
