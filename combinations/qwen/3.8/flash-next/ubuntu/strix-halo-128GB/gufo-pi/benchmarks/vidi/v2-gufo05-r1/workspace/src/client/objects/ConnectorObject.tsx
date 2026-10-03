/**
 * A connector: an arrow drawn between two things (`connector.object`).
 *
 * An arrow has no box of its own. Its whole geometry comes from its two endpoints, resolved
 * against the current rectangles of whatever they point at, so when a shape moves the line
 * that follows it is redrawn from the new snapshot — nothing is stored about the line itself
 * (`connector.follow`). The object layer already scales by zoom, so the arrow is drawn in
 * world units and grows and shrinks with the board; only its on-screen affordances (the click
 * tolerance and the re-attach dots) are divided by zoom to stay a fixed size to the eye.
 *
 * Two kinds of click reach an arrow:
 *
 * - **Selecting it** (`connector.select`): a pointer that lands within
 *   `CONNECTOR_HIT_TOLERANCE_PX` of the line. That is a wide invisible stroke under the
 *   visible one, sized in world units as `tolerance / zoom`, so "close to the arrow" means
 *   the same number of screen pixels at every zoom. A click in the middle of an arrow's
 *   bounding box, but far from the line, hits nothing — and so is not a mis-selection.
 * - **Re-attaching an end** (`connector.readjust`): when the arrow is selected, a dot sits on
 *   each end. Dragging a dot onto another object re-attaches that end to it; dropping it on
 *   empty space frees it to a point there; dropping it back on the object at the *other* end
 *   does nothing, because an arrow is never about to connect a thing to itself
 *   (`connector.self`).
 */
import {
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';

import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds, objectSnapshots } from '../../shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import type { Endpoint } from '../../shared/geometry/connector-geometry';
import { CONNECTOR_TYPE, setConnectorEndpoint, type ConnectorSnapshot } from '../../shared/objects/connector';
import { SHAPE_TYPE } from '../../shared/objects/shape';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { useCameraContext } from '../canvas/CameraContext';
import type { ObjectProps } from './registry';

export type ConnectorObjectProps = ObjectProps & { obj: ConnectorSnapshot };

/** The world rectangle of a point at the far end of the arrow, padded for its dots/hit. */
function paddedBox(start: Point, end: Point, pad: number) {
  const x = Math.min(start.x, end.x) - pad;
  const y = Math.min(start.y, end.y) - pad;
  return { x, y, width: Math.abs(end.x - start.x) + pad * 2, height: Math.abs(end.y - start.y) + pad * 2 };
}

/** The three corners of the arrowhead at `tip`, pointing along `dir`. */
function arrowhead(tip: Point, dir: Point, size: number): string {
  const px = -dir.y;
  const py = dir.x;
  const base = { x: tip.x - dir.x * size, y: tip.y - dir.y * size };
  const half = size * 0.5;
  return [
    `${tip.x},${tip.y}`,
    `${base.x + px * half},${base.y + py * half}`,
    `${base.x - px * half},${base.y - py * half}`,
  ].join(' ');
}

/** Is this object something an arrow may point at? (A shape or a note, never another arrow.) */
function connectable(object: ObjectSnapshot): boolean {
  return object.type === SHAPE_TYPE || object.type === 'sticky';
}

/** Which object is under a world point, or null. Straight containment: this is a click test. */
function objectAt(doc: Y.Doc, point: Point): ObjectSnapshot | null {
  for (const object of objectSnapshots(doc)) {
    if (!connectable(object)) continue;
    const b = objectBounds(object);
    if (point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height) {
      return object;
    }
  }
  return null;
}

export function ConnectorObject(props: ConnectorObjectProps) {
  const { obj, doc, zoom, selected, canEdit, onObjectPointerDown, undo } = props;
  const camera: Camera = useCameraContext().camera;
  const dragEndRef = useRef<'from' | 'to' | null>(null);

  const dirLen = Math.hypot(obj.end.x - obj.start.x, obj.end.y - obj.start.y) || 1;
  const dir = { x: (obj.end.x - obj.start.x) / dirLen, y: (obj.end.y - obj.start.y) / dirLen };

  // Everything the eye sees at a fixed size is written in world units divided by zoom,
  // because the layer it sits in is scaled by zoom.
  const hitStroke = (CONNECTOR_HIT_TOLERANCE_PX * 2) / zoom;
  const pad = Math.max(CONNECTOR_HIT_TOLERANCE_PX / zoom, CONNECTOR_DOT_RADIUS_PX / zoom, CONNECTOR_ARROWHEAD_SIZE_WORLD);
  const box = paddedBox(obj.start, obj.end, pad);
  const viewBox = `${box.x} ${box.y} ${box.width} ${box.height}`;

  const select = useCallback(
    (event: ReactPointerEvent<Element>) => {
      event.stopPropagation();
      onObjectPointerDown(event as unknown as ReactPointerEvent<HTMLElement>, obj.id);
    },
    [obj.id, onObjectPointerDown],
  );

  /** Where the pointer is, in world units — the same frame the object lives in. */
  const worldPoint = useCallback(
    (event: PointerEvent | ReactPointerEvent<Element>): Point =>
      screenToWorld(camera, { x: event.clientX, y: event.clientY }),
    [camera],
  );

  /** Finish a re-attach drag: attach to what is under the pointer, free it, or snap back. */
  const finishReattach = useCallback(
    (which: 'from' | 'to', event: PointerEvent) => {
      const point = worldPoint(event);
      const hit = objectAt(doc, point);
      // The object the *other* end is on — a re-attach may not point this end at it.
      const other = which === 'from' ? obj.to : obj.from;
      const otherObject = other.kind === 'attached' ? other.objectId : null;
      undo?.boundary();
      if (hit && hit.id !== otherObject) {
        setConnectorEndpoint(doc, obj.id, which, { kind: 'attached', objectId: hit.id, fallback: { x: point.x, y: point.y } });
      } else if (!hit) {
        setConnectorEndpoint(doc, obj.id, which, { kind: 'free', x: point.x, y: point.y });
      }
      // A drop on the object at the other end: refused, and the end stays where it was.
      undo?.boundary();
    },
    [doc, obj.id, obj.from, obj.to, undo, worldPoint],
  );

  /** Press a selected arrow's end dot and drag it somewhere else. */
  const beginHandleDrag = useCallback(
    (which: 'from' | 'to') => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!canEdit) return;
      event.stopPropagation();
      event.preventDefault();
      dragEndRef.current = which;
      const onUp = (upEvent: PointerEvent) => {
        window.removeEventListener('pointerup', onUp, true);
        const target = dragEndRef.current;
        dragEndRef.current = null;
        if (target) finishReattach(target, upEvent);
      };
      window.addEventListener('pointerup', onUp, true);
    },
    [canEdit, finishReattach],
  );

  const handleDot = (which: 'from' | 'to', at: Point): React.ReactNode => {
    if (!selected || !canEdit) return null;
    const size = (CONNECTOR_DOT_RADIUS_PX * 2) / zoom;
    return (
      <button
        type="button"
        key={which}
        className="connector-handle"
        data-testid="connector-handle"
        data-end={which}
        aria-label={which === 'from' ? 'Reattach connector start' : 'Reattach connector end'}
        style={{
          position: 'absolute',
          left: at.x,
          top: at.y,
          width: size,
          height: size,
          transform: 'translate(-50%, -50%)',
          borderRadius: '50%',
          border: 'none',
          padding: 0,
          background: '#2563eb',
          cursor: 'grab',
          pointerEvents: 'auto',
        }}
        onPointerDown={beginHandleDrag(which)}
      />
    );
  };

  return (
    <div
      className={`connector-object${selected ? ' connector-object--selected' : ''}`}
      data-testid="connector-object"
      data-object-id={obj.id}
      data-selected={selected}
      data-connector={obj.id}
      // Resolved world geometry and endpoint kinds, for end-to-end tests to read.
      data-start-x={obj.start.x}
      data-start-y={obj.start.y}
      data-end-x={obj.end.x}
      data-end-y={obj.end.y}
      data-from-kind={obj.from.kind}
      data-to-kind={obj.to.kind}
      data-from-id={obj.from.kind === 'attached' ? obj.from.objectId : ''}
      data-to-id={obj.to.kind === 'attached' ? obj.to.objectId : ''}
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      <svg
        viewBox={viewBox}
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        aria-hidden="true"
      >
        {/* The invisible wide stroke is what a click actually lands on; it is the reason a
            click within tolerance selects the arrow at any zoom (`connector.select`). */}
        <line
          data-testid="connector-hit"
          x1={obj.start.x}
          y1={obj.start.y}
          x2={obj.end.x}
          y2={obj.end.y}
          stroke="transparent"
          strokeWidth={hitStroke}
          strokeLinecap="round"
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={select}
        />
        <line
          x1={obj.start.x}
          y1={obj.start.y}
          x2={obj.end.x}
          y2={obj.end.y}
          stroke={selected ? '#2563eb' : '#475569'}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          strokeLinecap="round"
        />
        <polygon
          points={arrowhead(obj.end, dir, CONNECTOR_ARROWHEAD_SIZE_WORLD)}
          fill={selected ? '#2563eb' : '#475569'}
        />
      </svg>
      {handleDot('from', obj.start)}
      {handleDot('to', obj.end)}
    </div>
  );
}

// `CONNECTOR_TYPE` and `Endpoint` are re-exported through this module so the tool that
// draws new arrows can build endpoints without importing the model a second time.
export { CONNECTOR_TYPE };
export type { Endpoint };
