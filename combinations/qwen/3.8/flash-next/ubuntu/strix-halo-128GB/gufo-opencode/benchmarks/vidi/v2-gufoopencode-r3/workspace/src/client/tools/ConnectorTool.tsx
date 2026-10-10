import { useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import type { Point, Rect } from '../../shared/geometry';
import { nearestSide, sideAnchor } from '../../shared/geometry/connector-geometry';
import { createConnector, type Endpoint } from '../../shared/objects/connector';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { findConnectorTarget } from '../objects/ConnectorObject';

export interface ConnectorToolProps {
  doc: Y.Doc;
  camera: Camera;
  userId: string;
  // The connector was created (id given): undo boundary handling and
  // select + return-to-Select live in the caller (toolCreated).
  onCreated(id: string): void;
}

interface DragState {
  start: Point;
  startTarget: { id: string; rect: Rect } | null;
  current: Point;
  currentTarget: { id: string; rect: Rect } | null;
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

// Connector creation gesture: full-board overlay (objects cannot be clicked
// underneath). Hovering an object shows its four side dots; dragging from
// an object or empty space shows a preview line, highlights the target's
// nearest-side dot and creates the arrow on release. Same-object or too
// short drags create nothing and the tool stays active.
export function ConnectorTool({ doc, camera, userId, onCreated }: ConnectorToolProps): JSX.Element {
  const [hover, setHover] = useState<{ id: string; rect: Rect } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const updateDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const locate = (screen: Point) =>
    findConnectorTarget(doc, screenToWorld(cameraRef.current, screen), '', null, camera.zoom);

  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    updateDrag(null);
    if (d === null) return;
    const end = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const target = locate({ x: e.clientX, y: e.clientY });
    if (target !== null && d.startTarget !== null && target.id === d.startTarget.id) {
      return; // ends on the object it started on: nothing created
    }
    const from: Endpoint =
      d.startTarget !== null
        ? {
            kind: 'attached',
            objectId: d.startTarget.id,
            fallback: sideAnchor(d.startTarget.rect, nearestSide(d.startTarget.rect, end))
          }
        : { kind: 'free', x: d.start.x, y: d.start.y };
    const to: Endpoint =
      target !== null
        ? {
            kind: 'attached',
            objectId: target.id,
            fallback: sideAnchor(target.rect, nearestSide(target.rect, d.start))
          }
        : { kind: 'free', x: end.x, y: end.y };
    const id = createConnector(doc, from, to, userId);
    if (id !== null) onCreated(id);
  };

  // Where the visible line starts/ends right now (attached ends sit on
  // their object's side nearest the other end).
  let lineFrom: Point;
  let lineTo: Point;
  if (drag !== null) {
    lineFrom =
      drag.startTarget !== null
        ? sideAnchor(drag.startTarget.rect, nearestSide(drag.startTarget.rect, drag.current))
        : drag.start;
    lineTo = drag.current;
  } else {
    lineFrom = { x: 0, y: 0 };
    lineTo = { x: 0, y: 0 };
  }

  const dotTarget = drag !== null ? drag.currentTarget : hover;
  const highlightSide =
    drag !== null && drag.currentTarget !== null
      ? nearestSide(drag.currentTarget.rect, lineFrom)
      : null;

  return (
    <div
      data-testid="connector-tool-overlay"
      className="tool-overlay"
      style={{ cursor: 'crosshair' }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // jsdom and older engines lack pointer capture.
        }
        const world = screenToWorld(camera, { x: e.clientX, y: e.clientY });
        updateDrag({
          start: world,
          startTarget: locate({ x: e.clientX, y: e.clientY }),
          current: world,
          currentTarget: locate({ x: e.clientX, y: e.clientY })
        });
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        const screen = { x: e.clientX, y: e.clientY };
        if (d === null) {
          setHover(locate(screen));
          return;
        }
        updateDrag({
          ...d,
          current: screenToWorld(camera, screen),
          currentTarget: locate(screen)
        });
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        finish(e);
      }}
      onPointerCancel={() => {
        updateDrag(null);
      }}
    >
      {dotTarget !== null &&
        SIDES.map((side) => {
          const p = worldToScreen(camera, sideAnchor(dotTarget.rect, side));
          return (
            <div
              key={side}
              data-testid={`connector-dot-${side}`}
              data-object-id={dotTarget.id}
              data-highlighted={drag !== null && side === highlightSide ? 'true' : 'false'}
              className={
                drag !== null && side === highlightSide
                  ? 'connector-dot connector-dot-highlighted'
                  : 'connector-dot'
              }
              style={{ left: p.x, top: p.y }}
              aria-hidden="true"
            />
          );
        })}
      {drag !== null &&
        (() => {
          const a = worldToScreen(camera, lineFrom);
          const b = worldToScreen(camera, lineTo);
          return (
            <svg
              data-testid="connector-preview"
              className="connector-preview-svg"
              aria-hidden="true"
            >
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#1E88E5"
                strokeWidth={2}
                strokeDasharray="6 4"
              />
            </svg>
          );
        })()}
    </div>
  );
}
