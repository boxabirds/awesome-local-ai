import type { JSX } from 'react';

export interface DropHighlightProps {
  visible: boolean;
}

/**
 * The dashed outline that says *files may be let go here*.
 *
 * It is drawn over the whole board area rather than around some target inside it, because the target is
 * the board: there is no box an image has to be aimed at, and a highlight that covered less than everything
 * the pointer can be over would be a highlight that lies about where a file may be dropped.
 *
 * It has no text, and it is not announced. What it means while it is up - that letting go here puts
 * pictures on the board - is confirmed a moment later by the images themselves, or explained by a toast;
 * an announcement for every drag that crossed the edge of a window would be a board that talked whenever
 * somebody moved a mouse. The outline is decoration, and says so.
 */
export function DropHighlight({ visible }: DropHighlightProps): JSX.Element | null {
  if (!visible) {
    return null;
  }
  return <div className="drop-highlight" data-testid="drop-highlight" aria-hidden="true" />;
}
