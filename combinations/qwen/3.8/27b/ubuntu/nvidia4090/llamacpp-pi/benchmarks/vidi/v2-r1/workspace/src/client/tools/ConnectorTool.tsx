// ConnectorTool (story 10, connector.ui): the Connector tool's pointer
// gesture and its hover dots.
//
//  - Hover (connector.hover_points): while the pointer is over a board
//    object, four dots appear at the midpoints of its four sides.
//  - Drag: a press on an object stores that object as the start; a press on
//    empty space stores the press point. A dashed screen-space preview
//    follows the pointer. While the pointer is over a target object, the dot
//    it will attach to (the target's side nearest the other end) is
//    highlighted.
//  - Release: over a different object → both ends attached; over empty
//    space → that end free at the release point. Same-object or too-short
//    drags create nothing (connector.no_accidental). Success calls
//    onCreated(id), which selects the arrow and returns to Select.

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type * as Y from 'yjs';
import {
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_MIN_LENGTH_WORLD,
  CONNECTOR_STROKE_COLOR,
} from '../../shared/config';
import {
  createConnector,
  type Endpoint,
} from '../../shared/objects/connector';
import {
  nearestSide,
  sideAnchor,
  type Side,
} from '../../shared/geometry/connector-geometry';
import {
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { getClientId } from '../client-id';
import type { UndoController } from '../board/undo';
import type { Rect } from '../../shared/geometry';
import { objectAtPoint } from '../objects/registry';

export interface ConnectorToolProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  canEdit: boolean;
  undo?: UndoController;
  onCreated(id: string): void;
}

interface DragState {
  start: Point;
  startId: string | null;
  current: Point;
}

interface HoverState {
  id: string;
  rect: Rect;
}

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

function viewportBounds(): { left: number; top: number } {
  const v = document.querySelector('[data-testid="board-viewport"]');
  const r = v ? v.getBoundingClientRect() : null;
  return r ? { left: r.left, top: r.top } : { left: 0, top: 0 };
}

function centerOf(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function ConnectorTool(props: ConnectorToolProps): JSX.Element | null {
  const { camera, snapshot, doc, canEdit, undo, onCreated } = props;
  const [hover, setHover] = useState<HoverState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const hoverRef = useRef<HoverState | null>(null);
  const stateRef = useRef({ camera, snapshot, doc, canEdit, undo, onCreated });
  stateRef.current = { camera, snapshot, doc, canEdit, undo, onCreated };

  useEffect(() => {
    const toWorld = (clientX: number, clientY: number): Point => {
      const b = viewportBounds();
      return screenToWorld(stateRef.current.camera, {
        x: clientX - b.left,
        y: clientY - b.top,
      });
    };
    const inViewport = (t: EventTarget | null): boolean =>
      t instanceof Element && t.closest('[data-testid="board-viewport"]') !== null;
    const findAt = (p: Point): ObjectSnapshot | null =>
      objectAtPoint(stateRef.current.snapshot, p, stateRef.current.camera.zoom);

    const onPointerDown = (e: PointerEvent): void => {
      const s = stateRef.current;
      if (!s.canEdit) return;
      if (!inViewport(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.target instanceof Element && typeof e.target.setPointerCapture === 'function') {
        try {
          e.target.setPointerCapture(e.pointerId);
        } catch {
          // Ignore: best-effort (jsdom).
        }
      }
      const p = toWorld(e.clientX, e.clientY);
      const start = findAt(p);
      dragRef.current = { start: p, startId: start !== null ? start.id : null, current: p };
      setDrag(dragRef.current);
      setHover(null);
      hoverRef.current = null;
    };
    const onPointerMove = (e: PointerEvent): void => {
      const p = toWorld(e.clientX, e.clientY);
      const d = dragRef.current;
      if (d !== null) {
        dragRef.current = { ...d, current: p };
        setDrag(dragRef.current);
        return;
      }
      // Hover dots: track the object under the pointer (only re-render when
      // the hovered object changes).
      const hit = findAt(p);
      if (hit !== null) {
        const rect = objectBounds(hit);
        const prev = hoverRef.current;
        if (prev === null || prev.id !== hit.id) {
          hoverRef.current = { id: hit.id, rect };
          setHover(hoverRef.current);
        }
      } else if (hoverRef.current !== null) {
        hoverRef.current = null;
        setHover(null);
      }
    };
    const onPointerUp = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (d === null) return;
      dragRef.current = null;
      setDrag(null);
      const s = stateRef.current;
      const p = toWorld(e.clientX, e.clientY);
      const moved = Math.hypot(p.x - d.start.x, p.y - d.start.y);
      if (moved < CONNECTOR_MIN_LENGTH_WORLD) return; // too short: nothing
      const target = findAt(p);
      const snap = s.snapshot;
      const startObj = d.startId !== null ? snap.find((o) => o.id === d.startId) ?? null : null;
      if (target !== null && startObj !== null && target.id === startObj.id) {
        return; // same object: nothing
      }
      let from: Endpoint;
      let to: Endpoint;
      if (startObj !== null) {
        const r = objectBounds(startObj);
        const otherPos = target !== null ? centerOf(objectBounds(target)) : p;
        from = {
          kind: 'attached',
          objectId: startObj.id,
          fallback: sideAnchor(r, nearestSide(r, otherPos)),
        };
      } else {
        from = { kind: 'free', x: d.start.x, y: d.start.y };
      }
      if (target !== null) {
        const r = objectBounds(target);
        const otherPos = startObj !== null ? centerOf(objectBounds(startObj)) : d.start;
        to = {
          kind: 'attached',
          objectId: target.id,
          fallback: sideAnchor(r, nearestSide(r, otherPos)),
        };
      } else {
        to = { kind: 'free', x: p.x, y: p.y };
      }
      // One creation is one undo step.
      s.undo?.boundary();
      const id = createConnector(s.doc, from, to, getClientId());
      s.undo?.boundary();
      if (id !== null) s.onCreated(id);
    };
    const onPointerCancel = (): void => {
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove, { capture: true });
    window.addEventListener('pointerup', onPointerUp, { capture: true });
    window.addEventListener('pointercancel', onPointerCancel, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onPointerCancel, { capture: true });
    };
  }, []);

  // Dots for the hover target (idle) or the drag target (dragging).
  let dots: { rect: Rect; highlight: Side | null } | null = null;
  if (drag !== null) {
    const target = objectAtPoint(snapshot, drag.current, camera.zoom);
    if (target !== null) {
      const startObj =
        drag.startId !== null ? snapshot.find((o) => o.id === drag.startId) ?? null : null;
      const r = objectBounds(target);
      // The side the arrow will attach to: the target's side nearest the
      // OTHER end (the drag start, or the object it began on).
      const otherPos = startObj !== null ? centerOf(objectBounds(startObj)) : drag.start;
      dots = { rect: r, highlight: nearestSide(r, otherPos) };
    }
  } else if (hover !== null) {
    dots = { rect: hover.rect, highlight: null };
  }

  const previewStart = drag !== null ? worldToScreen(camera, drag.start) : null;
  const previewEnd = drag !== null ? worldToScreen(camera, drag.current) : null;

  return (
    <>
      {previewStart !== null && previewEnd !== null && (
        <svg
          className="connector-preview"
          data-testid="connector-preview"
          style={{
            position: 'fixed',
            inset: 0,
            width: '100vw',
            height: '100vh',
            pointerEvents: 'none',
            zIndex: 10000,
          }}
          aria-hidden="true"
        >
          <line
            x1={previewStart.x}
            y1={previewStart.y}
            x2={previewEnd.x}
            y2={previewEnd.y}
            stroke={CONNECTOR_STROKE_COLOR}
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        </svg>
      )}
      {dots !== null &&
        SIDES.map((side) => {
          const p = worldToScreen(camera, sideAnchor(dots.rect, side));
          const hl = dots.highlight === side;
          return (
            <div
              key={side}
              className={`connector-dot${hl ? ' connector-dot--highlighted' : ''}`}
              data-testid="connector-dot"
              data-side={side}
              data-highlighted={hl || undefined}
              style={{
                position: 'fixed',
                left: p.x - CONNECTOR_DOT_RADIUS_PX,
                top: p.y - CONNECTOR_DOT_RADIUS_PX,
                width: CONNECTOR_DOT_RADIUS_PX * 2,
                height: CONNECTOR_DOT_RADIUS_PX * 2,
                borderRadius: '50%',
                background: hl ? CONNECTOR_STROKE_COLOR : '#ffffff',
                border: `1.5px solid ${CONNECTOR_STROKE_COLOR}`,
                pointerEvents: 'none',
                zIndex: 10000,
                boxSizing: 'border-box',
              }}
              aria-hidden="true"
            />
          );
        })}
    </>
  );
}
