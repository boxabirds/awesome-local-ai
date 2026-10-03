/**
 * The light blue translucent box of a Shift+drag (`sel.marquee`).
 *
 * It is drawn inside the world layer, so its position and size are simply the box in
 * world units — the layer's transform puts it on the screen where the board says it
 * is, and it stays glued to the board while the pointer moves.
 *
 * The camera is here for one thing only: the border. A 1 pixel border inside a layer
 * that is scaled 40% would be a pale hairline nobody can see, and at 400% a fat frame,
 * so the width is divided by the zoom to keep it one pixel on the screen at every
 * level — the same reason the selection handles live outside the world layer.
 */
import type { Rect } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';

export interface MarqueeRectProps {
  /** The box in world units, or nothing while no marquee is being dragged. */
  rect: Rect | null;
  camera: Camera;
}

export function MarqueeRect({ rect, camera }: MarqueeRectProps) {
  if (!rect) return null;
  return (
    <div
      className="marquee"
      data-testid="marquee"
      aria-hidden="true"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        borderWidth: 1 / (camera.zoom || 1),
      }}
    />
  );
}
