// The dashed outline shown while image files are dragged over the board
// (`image.drop`).
//
// It answers one question — *would dropping here add these files?* — and does nothing
// else: it is not a target of its own (the drop still lands on the board viewport
// underneath it, which is why `pointer-events: none` is the whole of its behaviour),
// it holds no state (whether to show it is decided by the drop handler's
// dragenter/dragleave bookkeeping), and it adds nothing to the document. When it is
// not wanted it renders literally nothing, so it cannot be an empty box in the
// layout.
//
// It sits above the board's own layer but below the rail and the toast, in screen
// space, inset from the edges so the dashed line reads as "drop onto the board"
// rather than a border on the window.
//
// Spec: spec/stories/012-drop-images-onto-the-board/design.md, "Adding images".
import { type CSSProperties, type ReactNode } from 'react';

const highlightStyle: CSSProperties = {
  position: 'fixed',
  inset: 16,
  borderRadius: 12,
  border: '3px dashed #3b82f6',
  backgroundColor: 'rgba(59, 130, 246, 0.08)',
  // The drop is the board's, not this overlay's: a highlight you could drop onto
  // would swallow the very event it is there to describe.
  pointerEvents: 'none',
  zIndex: 30,
};

export interface DropHighlightProps {
  /** Files are being dragged over the board right now. */
  visible: boolean;
}

/** A dashed drop outline across the board, or nothing at all. */
export function DropHighlight({ visible }: DropHighlightProps): ReactNode {
  if (!visible) return null;
  return <div data-testid="drop-highlight" aria-hidden="true" style={highlightStyle} />;
}
