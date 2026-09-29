// The outline that says "let go here" (story 12, image.drop).
//
// It appears while a file is being dragged over the board and disappears the moment the drag
// leaves or is dropped, because the promise it makes is about the next second, not about the
// page: a frame that stayed up after the files were gone would be a claim about a drag that is
// over.
//
// It is drawn in *screen* space, as a child of the board rather than of the zoomed layer, for
// the same reason the selection handles are: the board may be at 10% or 400%, and a drop target
// that grew with the zoom would be a rectangle of one size at one zoom and another at the next.
// Nothing about it depends on the camera.

/** The sentence inside the frame. It names the action the drag is about to cause. */
export const DROP_PROMPT = 'Drop to add images';

export interface DropHighlightProps {
  shown: boolean;
  /** The words inside the frame, for a board that adds more than pictures someday. */
  prompt?: string;
}

export function DropHighlight({ shown, prompt = DROP_PROMPT }: DropHighlightProps) {
  if (!shown) return null;
  return (
    <div
      data-testid="drop-highlight"
      role="presentation"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 12,
        border: '3px dashed #2f6fed',
        borderRadius: 12,
        background: 'rgba(47, 111, 237, 0.08)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        padding: '0 0 28px',
        pointerEvents: 'none',
        zIndex: 40,
      }}
    >
      <span
        style={{
          background: '#ffffff',
          color: '#1c3d69',
          border: '1px solid #d6d9de',
          borderRadius: 999,
          padding: '6px 14px',
          fontSize: 15,
          fontWeight: 700,
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        }}
      >
        {prompt}
      </span>
    </div>
  );
}

export default DropHighlight;
