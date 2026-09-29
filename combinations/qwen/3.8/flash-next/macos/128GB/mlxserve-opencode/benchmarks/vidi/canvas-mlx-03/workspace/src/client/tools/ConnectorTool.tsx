// The Connector tool (story 10 `connector.ui`): drag an arrow from one object to another.
//
// Hovering an object puts four dots on it — the four points an end can weld to — and
// dragging from it trails a dashed line behind the pointer while the dot the end would
// land on is highlighted. Release over another object and both ends are welded to
// objects, so the arrow follows them for as long as they exist; release over empty board
// and that end is pinned to that board point instead (connector.create_attached,
// connector.create_free).
//
// The tool takes the board's pointer in the capture phase, exactly as the Shape tool
// does, so starting a drag on top of an object draws an arrow instead of moving that
// object. A release on the object the drag started from, or one shorter than
// `CONNECTOR_MIN_LENGTH_WORLD`, creates nothing and leaves the tool armed — those are
// mistakes, not gestures (connector.no_accidental). A cancelled pointer creates nothing.
// On success `onCreated` selects the arrow and hands the board back to Select.
//
// The dots and the preview are drawn in *screen* space, so a dot is
// `CONNECTOR_DOT_RADIUS_PX` on screen at every zoom level.

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type * as Y from 'yjs';
import {
  screenToWorld,
  worldToScreen,
  type Camera,
  type Point,
} from '../canvas/camera.ts';
import { objectRectsOf, createConnector, type Endpoint } from '../../shared/objects/connector.ts';
import { nearestSide, sideAnchor, type Side } from '../../shared/geometry/connector-geometry.ts';
import { type ObjectSnapshot } from '../../shared/board-model.ts';
import type { Rect } from '../../shared/geometry.ts';
import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config.ts';
import { useUndoBoundary } from '../board/useUndo.ts';
import { hitObjectAt } from './hitTarget.ts';

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

export interface ConnectorToolProps {
  doc: Y.Doc;
  /** The id this client is credited with (`createdBy`). */
  by: string;
  camera: Camera;
  /** Every object on the board: what an end can be attached to. */
  snapshot: readonly ObjectSnapshot[];
  /** The board surface this tool takes over while it is armed. */
  viewportRef: RefObject<HTMLElement | null>;
  /** False while the board is locked: the tool then takes nothing. */
  canEdit?: boolean;
  /** An arrow was created: select it and return to Select. */
  onCreated(id: string): void;
}

/** The live drag: where the end that started is stored, where the pointer is now. */
interface Drag {
  from: Endpoint;
  /** The board point the drag started at. */
  start: Point;
  /** The object the drag started on, if it started on one. */
  startId: string | null;
  /** Where the pointer is now. */
  ghost: Point;
  /** The object the pointer is over, when it is not the one it started from. */
  target: string | null;
}

/** A screen-space point of a world point, in the page coordinates `position: fixed` uses. */
function screenPoint(camera: Camera, rect: DOMRect | null, p: Point): Point {
  const s = worldToScreen(camera, p);
  return { x: s.x + (rect?.left ?? 0), y: s.y + (rect?.top ?? 0) };
}

/**
 * The centre the arrow will point its end towards: the centre of the object at the other
 * end when that end is attached (which is what `resolveEndpoints` faces), and the point
 * itself otherwise.
 */
function facing(rect: Rect | undefined, fallback: Point): Point {
  return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : fallback;
}

/**
 * The armed Connector tool: hover dots, a drag preview, and one arrow per gesture.
 */
export function ConnectorTool(props: ConnectorToolProps) {
  const [hover, setHover] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const cameraRef = useRef(props.camera);
  cameraRef.current = props.camera;
  const docRef = useRef(props.doc);
  docRef.current = props.doc;
  const byRef = useRef(props.by);
  byRef.current = props.by;
  const canEditRef = useRef(props.canEdit ?? true);
  canEditRef.current = props.canEdit ?? true;
  const createdRef = useRef(props.onCreated);
  createdRef.current = props.onCreated;
  const boundary = useUndoBoundary();

  // The live rectangles of everything an end can attach to, rebuilt when the board
  // changes and read through a ref so a pointer event never sees an old one.
  const rects = useMemo(() => objectRectsOf(props.snapshot), [props.snapshot]);
  const snapshotRef = useRef(props.snapshot);
  snapshotRef.current = props.snapshot;
  const rectsRef = useRef(rects);
  rectsRef.current = rects;
  const hoverRef = useRef<string | null>(null);
  const dragRef = useRef<Drag | null>(null);

  useEffect(() => {
    const el = props.viewportRef.current;
    if (!el) return;

    /** The board point of a pointer event. */
    const worldOf = (e: { clientX: number; clientY: number }): Point => {
      const r = el.getBoundingClientRect();
      return screenToWorld(cameraRef.current, { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    /** What an end placed at `p` would weld to. */
    const under = (p: Point, except: string | null | undefined) =>
      hitObjectAt(snapshotRef.current, p, {
        zoom: cameraRef.current.zoom,
        rects: rectsRef.current,
        except: except ?? undefined,
      });
    /** The dots and highlight of the object under the pointer right now. */
    const show = (id: string | null) => {
      hoverRef.current = id;
      setHover(id);
    };

    const onDown = (e: PointerEvent) => {
      if (!canEditRef.current) return;
      // The tool owns this pointer: no pan, no marquee, no drag of the object under it.
      e.preventDefault();
      e.stopPropagation();
      const at = worldOf(e);
      const hit = under(at, null);
      const next: Drag = {
        from: hit ? { kind: 'attached', objectId: hit.id, fallback: at } : { kind: 'free', x: at.x, y: at.y },
        start: at,
        startId: hit?.id ?? null,
        ghost: at,
        target: null,
      };
      dragRef.current = next;
      setDrag(next);
    };

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      const at = worldOf(e);
      if (!d) {
        // Hovering: the object under the pointer shows its four connection points, and
        // a move that stays on the same object changes nothing.
        const hit = under(at, null);
        const id = hit?.id ?? null;
        if (id !== hoverRef.current) show(id);
        return;
      }
      const hit = under(at, null);
      const next: Drag = { ...d, ghost: at, target: hit ? hit.id : null };
      dragRef.current = next;
      setDrag(next);
    };

    const finish = (e: PointerEvent, cancelled: boolean) => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d || cancelled) return; // a pointer that never lands draws nothing
      const at = worldOf(e);
      const hit = under(at, null);
      const target = hit?.id ?? null;
      // Back on the object it started from: an arrow from a shape to itself is not a
      // connection, so nothing is created and the tool stays armed.
      if (target && target === d.startId) return;
      // Over another object the end is welded to it; over empty board it is pinned to
      // that board point (connector.create_attached / connector.create_free).
      const to: Endpoint = target
        ? { kind: 'attached', objectId: target, fallback: at }
        : { kind: 'free', x: at.x, y: at.y };
      boundary();
      const id = createConnector(docRef.current, d.from, to, byRef.current);
      boundary();
      // An arrow shorter than the minimum is refused and leaves the tool armed.
      if (id) createdRef.current(id);
    };

    const onUp = (e: PointerEvent) => finish(e, false);
    const onCancel = (e: PointerEvent) => finish(e, true);

    el.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // Bound once per board surface; the gesture reads the camera, the snapshot and the
    // rects through refs, so it can never act on the frame the drag began in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.viewportRef]);

  // What the dots belong to: the object being dragged towards, else the one hovered.
  const shownId = drag?.target ?? hover;
  const shownRect: Rect | undefined = shownId ? rects.get(shownId) : undefined;
  // During a drag, the dot that end would land on is the side of the target facing the
  // centre the arrow will be drawn from — the same rule the arrow itself is drawn by,
  // so the highlighted dot is where the end lands and not a guess at it.
  const highlight: Side | null =
    drag && shownRect && drag.target && drag.target !== drag.startId
      ? nearestSide(shownRect, facing(drag.startId ? rects.get(drag.startId) : undefined, drag.start))
      : null;

  const rect = props.viewportRef.current?.getBoundingClientRect() ?? null;
  if (!shownRect && !drag) return null;

  return (
    <svg
      data-testid="connector-tool-overlay"
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 26,
      }}
    >
      {shownRect
        ? SIDES.map((side) => {
            const p = screenPoint(cameraRef.current, rect, sideAnchor(shownRect, side));
            const on = highlight === side;
            return (
              <circle
                key={side}
                data-testid={`connector-dot-${side}`}
                data-highlighted={on ? 'true' : 'false'}
                cx={p.x}
                cy={p.y}
                r={CONNECTOR_DOT_RADIUS_PX + (on ? 2 : 0)}
                fill={on ? '#2f6fed' : '#ffffff'}
                stroke="#2f6fed"
                strokeWidth={1.5}
              />
            );
          })
        : null}
      {drag ? (
        <line
          data-testid="connector-preview"
          x1={screenPoint(cameraRef.current, rect, drag.start).x}
          y1={screenPoint(cameraRef.current, rect, drag.start).y}
          x2={screenPoint(cameraRef.current, rect, drag.ghost).x}
          y2={screenPoint(cameraRef.current, rect, drag.ghost).y}
          stroke="#2f6fed"
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
      ) : null}
    </svg>
  );
}

export default ConnectorTool;
