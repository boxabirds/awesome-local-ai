import { worldToScreen } from '../canvas/camera';
import { useShapeTool, type ShapeToolArgs } from './useShapeTool';

/**
 * The Shape tool on the board (`shape.tool`): the gesture from `useShapeTool`, and
 * the dashed box that shows what the drag is making.
 *
 * The box is stored in world units and drawn in screen units, exactly like story
 * 7's marquee rectangle, so zooming mid-drag changes what it looks like and not
 * what it becomes. It is `pointer-events: none`: a preview is something you look
 * at, never something you click.
 */
export type ShapeToolProps = ShapeToolArgs;

export function ShapeTool(props: ShapeToolProps) {
  const gesture = useShapeTool(props);
  const { preview, kind } = gesture;
  const surface = props.surface;
  if (!preview || !surface) {
    return null;
  }
  const camera = surface.camera;
  const corner = worldToScreen(camera, { x: preview.x, y: preview.y });
  const opposite = worldToScreen(camera, {
    x: preview.x + preview.width,
    y: preview.y + preview.height,
  });
  return (
    <div className="shape-preview-layer" aria-hidden="true">
      <div
        className="shape-preview"
        data-testid="shape-preview"
        data-kind={kind}
        data-world-width={preview.width}
        data-world-height={preview.height}
        style={{
          left: `${Math.min(corner.x, opposite.x)}px`,
          top: `${Math.min(corner.y, opposite.y)}px`,
          width: `${Math.abs(opposite.x - corner.x)}px`,
          height: `${Math.abs(opposite.y - corner.y)}px`,
        }}
      />
    </div>
  );
}
