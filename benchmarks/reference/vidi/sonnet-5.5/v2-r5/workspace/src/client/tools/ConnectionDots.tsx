import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import { sideAnchor, type Side } from '../../shared/geometry/connector-geometry';
import { worldToScreen, type Camera } from '../canvas/camera';

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

/** The four side-midpoint dots of an object, in screen space; `highlight` marks the side an arrow would attach to. */
export function ConnectionDots(props: { rect: Rect; camera: Camera; highlight?: Side | null }) {
  const { rect, camera, highlight = null } = props;
  return (
    <>
      {SIDES.map((side) => {
        const p = worldToScreen(camera, sideAnchor(rect, side));
        const on = highlight === side;
        const r = on ? CONNECTOR_DOT_RADIUS_PX * 1.6 : CONNECTOR_DOT_RADIUS_PX;
        return (
          <div
            key={side}
            className={`connection-dot${on ? ' connection-dot-active' : ''}`}
            data-testid="connection-dot"
            data-side={side}
            data-highlighted={on}
            style={{ left: p.x - r, top: p.y - r, width: r * 2, height: r * 2 }}
          />
        );
      })}
    </>
  );
}
