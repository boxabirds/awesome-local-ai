import { objectBounds, snapshot } from "../../shared/board-model";
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HANDLE_SIZE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from "../../shared/config";
import { connectorLine, type ConnectorSnap } from "../../shared/objects/connector";
import type { ObjectProps } from "./registry";

/**
 * One connector (`connector.ui`, story 10).
 *
 * The arrow is drawn from its ends, resolved against the board **as it is now**:
 * `connectorLine` asks `resolveEndpoints` for the point on each attached object's
 * nearest side at its current position. So a move by anybody — this tab or
 * somebody else in the room — redraws it, an end whose object is gone draws
 * itself at the point it was attached to, and a free end draws itself where it was
 * dropped. Nothing writes the line.
 *
 * The line and its arrowhead are in board units, so they scale with the board
 * like every other object there. The two handles a selected arrow shows are the
 * arrow's ends, kept the same size on screen at any zoom, and are what
 * `ConnectorTool` picks up to re-attach an end.
 *
 * The whole object is `pointer-events: none`: an arrow is thin, and clicking near
 * it is answered by the board's precise hit test (`connector.select`), not by a
 * box around it that would swallow clicks meant for the board.
 */
export function ConnectorObject({ object, doc, zoom, selected }: ObjectProps) {
  const connector = object as ConnectorSnap;
  const box = objectBounds(object);
  const line = connectorLine(connector, snapshot(doc));
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

  // The line, in this object's own coordinate space.
  const from = { x: line.from.x - box.x, y: line.from.y - box.y };
  const to = { x: line.to.x - box.x, y: line.to.y - box.y };
  const markerId = `connector-arrowhead-${connector.id}`;

  return (
    <div
      className="connector-object"
      data-testid="connector-object"
      data-object-type="connector"
      data-note-id={connector.id}
      data-selected={selected ? "true" : "false"}
      data-connector-from={connector.from.kind}
      data-connector-to={connector.to.kind}
      aria-label="Connector"
      style={{
        left: `${round(box.x)}px`,
        top: `${round(box.y)}px`,
        width: `${round(box.width)}px`,
        height: `${round(box.height)}px`,
        zIndex: connector.z,
      }}
    >
      <svg
        className="connector-svg"
        data-testid="connector-svg"
        width={round(box.width)}
        height={round(box.height)}
        viewBox={`0 0 ${round(box.width)} ${round(box.height)}`}
        aria-hidden="true"
      >
        <defs>
          <marker
            id={markerId}
            markerWidth={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            markerHeight={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            refX={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            refY={CONNECTOR_ARROWHEAD_SIZE_WORLD / 2}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <polygon
              className="connector-arrowhead"
              points={`0,0 ${CONNECTOR_ARROWHEAD_SIZE_WORLD},${CONNECTOR_ARROWHEAD_SIZE_WORLD / 2} 0,${CONNECTOR_ARROWHEAD_SIZE_WORLD}`}
            />
          </marker>
        </defs>
        <line
          className="connector-line"
          data-testid="connector-line"
          x1={round(from.x)}
          y1={round(from.y)}
          x2={round(to.x)}
          y2={round(to.y)}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          markerEnd={`url(#${markerId})`}
        />
      </svg>

      {selected ? (
        <>
          <Handle end="from" point={from} scale={scale} />
          <Handle end="to" point={to} scale={scale} />
        </>
      ) : null}
    </div>
  );
}

/**
 * One end of a selected arrow. The anchor sits exactly on the end point and
 * un-scales itself by the board zoom, so the handle is `CONNECTOR_HANDLE_SIZE_PX`
 * on screen whatever the zoom.
 */
function Handle({ end, point, scale }: { end: "from" | "to"; point: { x: number; y: number }; scale: number }) {
  const half = CONNECTOR_HANDLE_SIZE_PX / 2;
  return (
    <div
      className="connector-handle-anchor"
      data-testid="connector-handle"
      data-connector-end={end}
      style={{ left: `${round(point.x)}px`, top: `${round(point.y)}px`, transform: `scale(${1 / scale})` }}
    >
      <div className="connector-handle" style={{ left: `${-half}px`, top: `${-half}px` }} />
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
