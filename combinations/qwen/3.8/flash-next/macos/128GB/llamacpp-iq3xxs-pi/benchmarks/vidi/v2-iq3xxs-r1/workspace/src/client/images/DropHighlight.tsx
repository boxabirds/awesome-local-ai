import type { JSX } from 'react';

/**
 * The board's answer to "is there something I can drop here?" (PRD image.drop: "WHILE
 * files are dragged over the board THE SYSTEM SHALL show a drop highlight").
 *
 * It is one overlay over the whole board, not a ring around each placeholder: while the
 * files are still in the air nobody knows how many there are or where they would land.
 * It never takes a pointer event, so it cannot be the reason a drop misses the board,
 * and it says nothing to a screen reader — the messages about what actually happened
 * are the toasts.
 */
export function DropHighlight(): JSX.Element {
  return (
    <div className="drop-highlight" data-testid="drop-highlight" aria-hidden="true">
      <span className="drop-highlight-label">Drop images here</span>
    </div>
  );
}
