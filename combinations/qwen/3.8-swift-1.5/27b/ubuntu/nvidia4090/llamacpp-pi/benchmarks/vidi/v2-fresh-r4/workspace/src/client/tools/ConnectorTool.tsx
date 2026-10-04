/**
 * ConnectorTool (story 10): draws an arrow between two objects (or to a free
 * point).
 *
 * - Hovering an object shows four anchor dots at its side midpoints.
 * - Drag from an object (or a dot): the arrow starts at the object's side
 *   facing the drag point.
 * - Drag to another object: the highlighted dot snaps the end to that side.
 * - Release on empty board: the end is a free point.
 * - Release on the same object: nothing is created.
 *
 * Creates via `createConnector` (one LOCAL_ORIGIN update) and calls
 * `onCreated(id)`.
 */
import { useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import type { Point, Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import {
  nearestSide,
  sideAnchor,
  type Side,
} from '../../shared/geometry/connector-geometry';
import {
  createConnector,
  type Endpoint,
} from '../../shared/objects/connector';
import { hitObjectAt } from '../objects/ConnectorObject';
import type { ObjectSnapshot } from '../../shared/board-model';
import { LOCAL_USER_ID } from '../../shared/config';

export interface ConnectorToolProps {
  camera: Camera;
  /** Current object snapshots (for hit tests). */
  snapshot: readonly ObjectSnapshot[];
  /** Current bounds of all objects. */
  rects: ReadonlyMap<string, Rect>;
  doc: Y.Doc;
  onCreated(id: string): void;
  canEdit?: boolean;
}

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

interface DragState {
  start: Endpoint;
  startId: string | null;
  cursor: Point; // screen
  targetId: string | null;
  targetSide: Side | null;
}

export function ConnectorTool(props: ConnectorToolProps): JSX.Element {
  const { camera, snapshot, rects, doc, onCreated, canEdit = true } = props;
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const camRef = useRef(camera);
  camRef.current = camera;

  const worldAt = (screen: Point): Point => screenToWorld(camRef.current, screen);

  const objectAt = (world: Point): ObjectSnapshot | null =>
    hitObjectAt(snapshot, world, camRef.current.zoom, rects);

  const anchorDots = (id: string): { side: Side; screen: Point }[] | null => {
    const r = rects.get(id);
    if (!r) return null;
    return SIDES.map((side) => ({
      side,
      screen: worldToScreen(camRef.current, sideAnchor(r, side)),
    }));
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canEdit || e.button !== 0) return;
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // jsdom
    }
    const screen = { x: e.clientX, y: e.clientY };
    const world = worldAt(screen);
    const target = objectAt(world);
    let start: Endpoint;
    let startId: string | null = null;
    if (target) {
      const r = rects.get(target.id)!;
      start = {
        kind: 'attached',
        objectId: target.id,
        fallback: sideAnchor(r, nearestSide(r, world)),
      };
      startId = target.id;
    } else {
      start = { kind: 'free', x: world.x, y: world.y };
    }
    setDrag({ start, startId, cursor: screen, targetId: null, targetSide: null });
  };

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) {
      // Hover tracking.
      const world = worldAt({ x: e.clientX, y: e.clientY });
      const t = objectAt(world);
      const id = t ? t.id : null;
      if (id !== hoverId) setHoverId(id);
      return;
    }
    const screen = { x: e.clientX, y: e.clientY };
    const world = worldAt(screen);
    const t = objectAt(world);
    const targetId = t && t.id !== drag.startId ? t.id : null;
    const targetSide =
      targetId && rects.get(targetId)
        ? nearestSide(rects.get(targetId)!, world)
        : null;
    setDrag({ ...drag, cursor: screen, targetId, targetSide });
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const world = worldAt({ x: e.clientX, y: e.clientY });
    const t = objectAt(world);
    let to: Endpoint | null = null;
    if (t && t.id !== drag.startId) {
      const r = rects.get(t.id)!;
      to = {
        kind: 'attached',
        objectId: t.id,
        fallback: sideAnchor(r, nearestSide(r, world)),
      };
    } else if (!t) {
      to = { kind: 'free', x: world.x, y: world.y };
    }
    // t === start object: nothing is created.
    if (to) {
      const id = createConnector(doc, drag.start, to, LOCAL_USER_ID);
      if (id) onCreated(id);
    }
    setDrag(null);
  };

  const cancelDrag = () => setDrag(null);

  // Dots to show: the drag target while dragging, else the hovered object.
  const dotObjectId = drag ? drag.targetId : hoverId;
  const dots = dotObjectId ? anchorDots(dotObjectId) : null;

  // Drag preview line (screen space).
  let preview: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (drag) {
    const startWorld: Point =
      drag.start.kind === 'free' ? { x: drag.start.x, y: drag.start.y } : { ...drag.start.fallback };
    const s = worldToScreen(camRef.current, startWorld);
    preview = { x1: s.x, y1: s.y, x2: drag.cursor.x, y2: drag.cursor.y };
  }

  return (
    <div
      data-vidi6="connector-tool"
      className="tool-overlay"
      style={{ cursor: 'crosshair' }}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={(e) => {
        if (e.button === 0) finishDrag(e);
      }}
      onPointerCancel={cancelDrag}
    >
      {dots?.map((d) => (
        <div
          key={d.side}
          data-vidi6="connector-dot"
          data-side={d.side}
          data-highlighted={drag?.targetSide === d.side ? 'true' : undefined}
          className="connector-dot"
          style={{
            position: 'absolute',
            left: d.screen.x - 4,
            top: d.screen.y - 4,
            width: 8,
            height: 8,
          }}
        />
      ))}
      {preview && (
        <svg
          data-vidi6="connector-preview"
          className="connector-preview"
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
          width="100%"
          height="100%"
        >
          <line
            x1={preview.x1}
            y1={preview.y1}
            x2={preview.x2}
            y2={preview.y2}
            stroke="#263238"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        </svg>
      )}
    </div>
  );
}
