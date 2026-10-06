/**
 * The dashed outline that says "drop it here" (story 12).
 *
 * It answers one question - what will happen if I let go now - and only while a *file* is being
 * dragged over the board. A drag of a board object, a selection or text shows nothing, because
 * those already have their own feedback and a second outline would be a lie about what is coming.
 *
 * It is `aria-hidden` and `pointer-events: none`: the drop belongs to the board underneath it, and a
 * screen reader is told about the images when they arrive, not about an outline.
 */
import type { JSX } from 'react';

export function DropHighlight({ visible }: { visible: boolean }): JSX.Element | null {
  if (!visible) return null;
  return (
    <div
      className="board-drop-highlight"
      data-testid="drop-highlight"
      aria-hidden="true"
      data-visible="true"
    />
  );
}
