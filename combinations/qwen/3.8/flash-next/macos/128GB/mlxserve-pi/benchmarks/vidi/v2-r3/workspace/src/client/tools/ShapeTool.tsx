import type { JSX } from 'react';
import type { Rect } from '../../shared/geometry';

/**
 * The shape being drawn, before it is a shape.
 *
 * It is drawn in screen space over the board — the same way the marquee is drawn,
 * for the same reason: what is being described is a drag, which is a thing that
 * happened between the pointer and the screen, and a preview that was itself
 * scaled by the camera would be a preview of the wrong size at any zoom other than
 * the one it was imagined at. So this is a dashed rectangle the size of the drag,
 * and nothing else: not an outline in the shape's colour, not the label, not a
 * fill. It says "a shape, this big, here" and gets out of the way.
 *
 * It does not take the pointer either: the tool is watching it on the window, and
 * an overlay that caught these events would be an overlay that stopped the drag it
 * is drawing.
 */
export function ShapePreview(props: { rect: Rect | null }): JSX.Element | null {
  const { rect } = props;
  if (rect === null) return null;
  return (
    <div
      className="shape-preview"
      data-testid="shape-preview"
      data-width={Math.round(rect.width)}
      data-height={Math.round(rect.height)}
      style={{
        position: 'fixed',
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        pointerEvents: 'none',
      }}
    />
  );
}
