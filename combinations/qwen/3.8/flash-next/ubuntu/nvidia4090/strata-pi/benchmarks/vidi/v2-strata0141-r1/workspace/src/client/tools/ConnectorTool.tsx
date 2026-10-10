import { worldToScreen } from '../canvas/camera';
import { SIDES, sideAnchor, type Side } from '../../shared/geometry/connector-geometry';
import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';
import { useConnectorTool, type ConnectorToolArgs } from './useConnectorTool';

/**
 * The Connector tool on the board (`connector.tool`, `connector.attach`): the four
 * attach dots of the object under the pointer, and the arrow being dragged.
 *
 * Both are drawn in screen space, above the world layer. The dots are a fixed size
 * on the screen whatever the zoom - `CONNECTOR_DOT_RADIUS_PX` - because they are
 * something a person aims at, not something on the board, and an arrow's attach
 * point is only useful if it can be seen at 25% zoom as well as at 400%.
 *
 * Everything here is `pointer-events: none`: the dots *show* where an end will
 * attach, and the press that attaches it is taken by the tool on `window`.
 */
export type ConnectorToolProps = ConnectorToolArgs;

export function ConnectorTool(props: ConnectorToolProps) {
  const { preview, dots } = useConnectorTool(props);
  const surface = props.surface;
  if (!surface) {
    return null;
  }
  const camera = surface.camera;

  return (
    <>
      {dots ? (
        <div className="connector-dots-layer" data-testid="connector-dots" aria-hidden="true">
          {SIDES.map((side: Side) => {
            const anchor = worldToScreen(camera, sideAnchor(dots.rect, side));
            const active = dots.active === side;
            return (
              <span
                key={side}
                className="connector-dot"
                data-testid="connector-dot"
                data-side={side}
                data-active={active ? 'true' : 'false'}
                style={{
                  left: `${anchor.x - CONNECTOR_DOT_RADIUS_PX}px`,
                  top: `${anchor.y - CONNECTOR_DOT_RADIUS_PX}px`,
                  width: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
                  height: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
                }}
              />
            );
          })}
        </div>
      ) : null}
      {preview ? (
        <svg
          className="connector-preview-layer"
          data-testid="connector-preview"
          width={surface.width}
          height={surface.height}
          aria-hidden="true"
        >
          <line
            className="connector-preview-line"
            data-testid="connector-preview-line"
            x1={worldToScreen(camera, preview.from).x}
            y1={worldToScreen(camera, preview.from).y}
            x2={worldToScreen(camera, preview.to).x}
            y2={worldToScreen(camera, preview.to).y}
          />
        </svg>
      ) : null}
    </>
  );
}
