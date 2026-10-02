import type { JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Point, Rect } from '../../shared/geometry';
import { CONNECTOR_DOT_RADIUS_PX, type ConnectorSide } from '../../shared/config';
import { attachDots, type ConnectorDrag } from './useConnectorTool';

export interface ConnectorOverlayProps {
  /** Board to screen, as it is at this moment. */
  worldToScreen(point: Point): Point;
  /** The object whose four attach points are shown, if any. */
  target: ObjectSnapshot | null;
  /** The arrow in flight. */
  drag: ConnectorDrag | null;
}

/**
 * The attach points of the shape the pointer is over, and the arrow being drawn
 * between them (design section 5.3).
 *
 * A shape shows four dots, one at the middle of each of its sides, because a side
 * is what an arrow attaches to: the dot that is lit is the side the arrow would
 * take, and it is the side the model picks from the same two boxes, so what is
 * offered and what would be stored are never two different answers.
 *
 * Everything here is drawn in screen space and sized in screen pixels. The dots
 * are the size of the finger that has to hit them at every zoom, which is the same
 * reason a sticky note's toolbar is scaled by 1/zoom; the line being dragged is the
 * only part of an arrow that is allowed to be drawn in board units, and it is not —
 * it is drawn from the two screen points the drag is at.
 */
export function ConnectorOverlay(props: ConnectorOverlayProps): JSX.Element | null {
  const { target, drag } = props;
  if (target === null && drag === null) return null;

  const box: Rect | null = target === null ? null : objectBounds(target);
  const dots = target !== null && box !== null ? attachDots(box, target.id).points : [];
  const lit = drag !== null ? nearestSideOf(dots, drag.targetSide) : null;

  return (
    <div className="connector-overlay" data-testid="connector-overlay" style={{ pointerEvents: 'none' }}>
      {dots.map((dot) => {
        const at = props.worldToScreen(dot.at);
        const isLit = drag !== null && lit !== null && dot.side === lit;
        return (
          <span
            key={dot.side}
            className={`attach-dot${isLit ? ' is-lit' : ''}`}
            data-side={dot.side}
            data-testid={`attach-dot-${dot.side}`}
            data-lit={isLit ? 'true' : 'false'}
            style={{
              left: `${at.x - CONNECTOR_DOT_RADIUS_PX}px`,
              top: `${at.y - CONNECTOR_DOT_RADIUS_PX}px`,
              width: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
              height: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
            }}
          />
        );
      })}
      {drag === null ? null : <DragLine drag={drag} worldToScreen={props.worldToScreen} />}
    </div>
  );
}

/** The line and head of the arrow being drawn, between the two screen points. */
function DragLine(props: { drag: ConnectorDrag; worldToScreen(point: Point): Point }): JSX.Element {
  const a = props.worldToScreen(props.drag.from);
  const b = props.worldToScreen(props.drag.to);
  return (
    <svg className="connector-preview-svg" data-testid="connector-preview" aria-hidden="true" focusable="false">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
    </svg>
  );
}

/** Which of the four points the moving end has chosen, which is the one the drag
 *  itself names — the side the model will read back out of the two boxes. */
function nearestSideOf(
  dots: readonly { side: ConnectorSide; at: Point }[],
  side: ConnectorSide | null,
): ConnectorSide | null {
  if (side === null) return null;
  return dots.some((dot) => dot.side === side) ? side : null;
}
