import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { createConnector } from '../../shared/objects/connector';
import { nearestSide, resolveEndpoints, sideAnchor, type Endpoint } from '../../shared/geometry/connector-geometry';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config';
import type { AnySnapshot } from '../../shared/board-model';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import type { Rect } from '../../shared/geometry';

/** The four side midpoints, in the order the contract lists them. */
const SIDE_ORDER = ['top', 'right', 'bottom', 'left'] as const;

export interface ConnectorToolProps {
  /** The board to draw into. */
  doc: Y.Doc;
  /** The live camera, for both directions of the screen↔world conversion. */
  camera: Camera;
  /** Every board object, with its footprint: what the pointer picks. */
  snapshot: readonly AnySnapshot[];
  /** An arrow was created: select it and disarm the tool. */
  onCreated(id: string): void;
  /** Whose hand is drawing (stored as `createdBy`). */
  by?: string;
  /** False while the board cannot be loaded: the tool draws nothing. */
  editable?: boolean;
}

/** An object the pointer can attach to. Arrows are not attach targets, so they
 * are never picked — a drag that lands on a line just ends in empty space. */
interface Pick {
  id: string;
  rect: Rect;
}

/** The smallest box under a world point. The innermost box wins so an arrow
 * dropped on a cluster attaches to the thing it was actually aimed at. */
function pickAt(snapshot: readonly AnySnapshot[], p: Point): Pick | null {
  let best: Pick | null = null;
  for (const object of snapshot) {
    if (object.type === 'connector') continue;
    const rect: Rect = { x: object.x, y: object.y, width: object.width, height: object.height };
    if (p.x < rect.x || p.y < rect.y) continue;
    if (p.x > rect.x + rect.width || p.y > rect.y + rect.height) continue;
    const area = rect.width * rect.height;
    if (best !== null && area >= best.rect.width * best.rect.height) continue;
    best = { id: object.id, rect };
  }
  return best;
}

function rectMap(snapshot: readonly AnySnapshot[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const object of snapshot) {
    if (object.type === 'connector') continue;
    rects.set(object.id, { x: object.x, y: object.y, width: object.width, height: object.height });
  }
  return rects;
}

/** The point an end draws at right now, so the preview matches the arrow that
 * will be created (a missing target draws at its own anchor). */
function drawnEnds(from: Endpoint, to: Endpoint, snapshot: readonly AnySnapshot[]) {
  return resolveEndpoints({ from, to }, rectMap(snapshot));
}

interface Gesture {
  /** Where the arrow starts: an object, or a board point. */
  start: Pick | null;
  /** The board point the drag began at (its free-end candidate). */
  startPoint: Point;
  /** The pointer's current world point. */
  point: Point;
  /** The object currently under the pointer. */
  target: Pick | null;
}

/** The endpoints a released gesture describes. */
function endpointsOf(gesture: Gesture): { from: Endpoint; to: Endpoint } {
  const start: Endpoint =
    gesture.start === null
      ? { kind: 'free', x: gesture.startPoint.x, y: gesture.startPoint.y }
      : { kind: 'attached', objectId: gesture.start.id, fallback: { x: 0, y: 0 } };
  const end: Endpoint =
    gesture.target === null
      ? { kind: 'free', x: gesture.point.x, y: gesture.point.y }
      : { kind: 'attached', objectId: gesture.target.id, fallback: { x: 0, y: 0 } };
  return { from: start, to: end };
}

/**
 * The Connector tool: one full-board input layer, armed by `L` or the toolbar.
 *
 * It sits above the world, so a press never reaches the object underneath — the
 * tool owns the gesture and decides what each end attaches to. While the pointer
 * is over a board object its four side midpoints are shown (contract
 * `connector.hover_points`); while dragging, the dot the arrow would attach to
 * is highlighted and a dashed preview shows the exact line that would be drawn.
 *
 * Every rejection lives in the model (`connector.no_accidental`): a drag that
 * ends on the object it started on, or that never reached
 * `CONNECTOR_MIN_LENGTH_WORLD`, creates nothing and leaves the tool armed.
 */
export function ConnectorTool({ doc, camera, snapshot, onCreated, by = 'local', editable = true }: ConnectorToolProps) {
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<{
    from: Point;
    to: Point;
    hover: Rect | null;
    /** The side whose dot the arrow would take, on the hovered object. */
    targetSide: (typeof SIDE_ORDER)[number] | null;
    /** Where the pointer is: the dots follow it, not the object's centre. */
    hoverPoint: Point;
  } | null>(null);

  const local = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /** Recompute what the layer shows for a pointer at a screen point. */
  const show = (screen: Point, dragging: boolean) => {
    const worldPoint = screenToWorld(camera, screen);
    const hover = pickAt(snapshot, worldPoint);
    if (!dragging) {
      if (hover === null) {
        setPreview(null);
        return;
      }
      setPreview({
        from: { x: 0, y: 0 },
        to: { x: 0, y: 0 },
        hover: hover.rect,
        targetSide: null,
        hoverPoint: worldPoint,
      });
      return;
    }
    const current = gesture.current;
    if (current === null) return;
    const planned = endpointsOf(current);
    const ends = drawnEnds(planned.from, planned.to, snapshot);
    const targetRect = current.target?.rect ?? null;
    setPreview({
      from: ends.from,
      to: ends.to,
      hover: targetRect,
      targetSide: targetRect === null ? null : nearestSide(targetRect, ends.from),
      hoverPoint: worldPoint,
    });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // The tool owns the press: nothing under it moves and the board does not pan.
    e.stopPropagation();
    e.preventDefault();
    if (!editable) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const screen = local(e);
    const worldPoint = screenToWorld(camera, screen);
    const start = pickAt(snapshot, worldPoint);
    gesture.current = {
      start,
      startPoint: worldPoint,
      point: worldPoint,
      target: start,
    };
    show(screen, true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const screen = local(e);
    const current = gesture.current;
    if (current === null) {
      show(screen, false);
      return;
    }
    const worldPoint = screenToWorld(camera, screen);
    const target = pickAt(snapshot, worldPoint);
    // The end follows the pointer's object, not the object it started on: a
    // drag that leaves every object ends in empty space (connector.create_free).
    gesture.current = { ...current, point: worldPoint, target };
    show(screen, true);
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    e.stopPropagation();
    const current = gesture.current;
    gesture.current = null;
    setPreview(null);
    if (current === null || cancelled || !editable) return;
    const screen = local(e);
    const worldPoint = screenToWorld(camera, screen);
    const target = pickAt(snapshot, worldPoint);
    const gesture2: Gesture = { ...current, point: worldPoint, target };
    const { from, to } = endpointsOf(gesture2);
    const id = createConnector(doc, from, to, by);
    // A refused arrow (same object at both ends, too short, or no length at all)
    // leaves the tool armed and creates nothing.
    if (id !== null) onCreated(id);
  };

  // The dots: the four side midpoints of the object under the pointer. The one
  // the arrow would take is drawn filled while dragging.
  const dots: { key: string; x: number; y: number; side: (typeof SIDE_ORDER)[number] }[] = [];
  if (preview?.hover) {
    for (const side of SIDE_ORDER) {
      const anchor = sideAnchor(preview.hover, side);
      const screen = worldToScreen(camera, anchor);
      dots.push({ key: side, x: screen.x, y: screen.y, side });
    }
  }
  const previewScreen =
    preview === null || preview.from === preview.to
      ? null
      : {
          from: worldToScreen(camera, preview.from),
          to: worldToScreen(camera, preview.to),
        };

  return (
    <div
      data-testid="connector-tool-layer"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'auto', cursor: 'crosshair', zIndex: 4 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
    >
      {dots.map((dot) => (
        <div
          key={dot.key}
          data-testid={dot.side === preview?.targetSide ? 'connector-dot-target' : 'connector-dot'}
          data-side={dot.side}
          data-highlight={dot.side === preview?.targetSide ? 'true' : 'false'}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: dot.x - CONNECTOR_DOT_RADIUS_PX,
            top: dot.y - CONNECTOR_DOT_RADIUS_PX,
            width: CONNECTOR_DOT_RADIUS_PX * 2,
            height: CONNECTOR_DOT_RADIUS_PX * 2,
            borderRadius: '50%',
            background: dot.side === preview?.targetSide ? '#2563eb' : '#ffffff',
            border: '1.5px solid #2563eb',
            pointerEvents: 'none',
          }}
        />
      ))}
      {previewScreen !== null && (
        <svg
          data-testid="connector-preview"
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          <line
            x1={previewScreen.from.x}
            y1={previewScreen.from.y}
            x2={previewScreen.to.x}
            y2={previewScreen.to.y}
            stroke="#2563eb"
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
        </svg>
      )}
    </div>
  );
}

/** The length a released drag must beat for an arrow to exist. Exported for the
 * tool's own tests; the rule itself lives in the model. */
export const MIN_ARROW_LENGTH = CONNECTOR_MIN_LENGTH_WORLD;
