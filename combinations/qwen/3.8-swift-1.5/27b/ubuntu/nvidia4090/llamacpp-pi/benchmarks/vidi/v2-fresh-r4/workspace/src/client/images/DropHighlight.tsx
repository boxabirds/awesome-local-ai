/**
 * Drop highlight overlay (story 12): dashed outline shown while files are
 * dragged over the board area.
 */
import type { JSX } from 'react';

export function DropHighlight(): JSX.Element {
  return (
    <div
      className="drop-highlight"
      data-vidi6="drop-highlight"
      aria-hidden="true"
    />
  );
}
