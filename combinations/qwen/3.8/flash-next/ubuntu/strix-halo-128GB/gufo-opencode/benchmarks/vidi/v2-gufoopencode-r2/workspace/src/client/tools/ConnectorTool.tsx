// Connector tool (Connector button or L): hovering a board object shows the
// four side dots it can attach to; dragging from an object (or empty space)
// previews an arrow, highlighting the side dot it will join. On pointerup a
// connector is created via createConnector (which refuses same-object and
// too-short arrows) and the tool returns to Select; a rejected creation keeps
// the tool active and creates nothing.

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Camera } from '../canvas/camera';
import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { rectContains } from '../../shared/geometry';
import {
  nearestSide,
  sideAnchor,
  type Endpoint,
  type Side,
} from '../../shared/geometry/connector-geometry';
import { createConnector } from '../../shared/objects/connector';
import type { UndoController } from '../board/undo';
import { screenToWorld, worldToScreen } from '../canvas/camera';

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

export interface ConnectorToolProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  by: string;
  undo?: UndoController;
  onCreated(id: string): void;
}

function rectsFrom(snapshot: readonly ObjectSnapshot[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const o of snapshot) {
    if (o.type === 'connector') continue;
    rects.set(o.id, { x: o.x, y: o.y, width: o.width ?? 0, height: o.height ?? 0 });
  }
  return rects;
}

function objectAt(
  rects: ReadonlyMap<string, Rect>,
  snapshot: readonly ObjectSnapshot[],
  p: Point,
): { id: string; rect: Rect } | undefined {
  let best: { id: string; rect: Rect; z: number } | undefined;
  for (const o of snapshot) {
    if (o.type === 'connector') continue;
    const r = { x: o.x, y: o.y, width: o.width ?? 0, height: o.height ?? 0 };
    if (!rectContains(r, { x: p.x, y: p.y, width: 0, height: 0 })) continue;
    if (!best || o.z >= best.z) best = { id: o.id, rect: r, z: o.z };
  }
  return best ? { id: best.id, rect: best.rect } : undefined;
}

function center(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

interface DragState {
  startWorld: Point;
  startId: string | undefined;
  cursorWorld: Point;
  targetId: string | undefined;
}

export function ConnectorTool({
  camera,
  snapshot,
  doc,
  by,
  undo,
  onCreated,
}: ConnectorToolProps): React.JSX.Element {
  const catcherRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [hoverId, setHoverId] = useState<string | undefined>(undefined);
  const [drag, setDrag] = useState<DragState | null>(null);

  const rects = rectsFrom(snapshot);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const el = catcherRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const toWorld = (clientX: number, clientY: number): Point =>
        screenToWorld(camera, { x: clientX - rect.left, y: clientY - rect.top });
      const startWorld = toWorld(e.clientX, e.clientY);
      const startObj = objectAt(rects, snapshot, startWorld);
      setDrag({
        startWorld,
        startId: startObj?.id,
        cursorWorld: startWorld,
        targetId: undefined,
      });
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // jsdom: no pointer capture; window listeners below still drive it.
      }

      const onMove = (ev: PointerEvent): void => {
        const w = toWorld(ev.clientX, ev.clientY);
        const under = objectAt(rects, snapshot, w);
        setDrag((d) =>
          d
            ? {
                ...d,
                cursorWorld: w,
                targetId: under && under.id !== d.startId ? under.id : undefined,
              }
            : d,
        );
      };
      const onUp = (ev: PointerEvent): void => {
        cleanupRef.current?.();
        cleanupRef.current = null;
        setDrag(null);
        setHoverId(undefined);
        const end = toWorld(ev.clientX, ev.clientY);
        const target = objectAt(rects, snapshot, end);
        const useTarget = target && target.id !== startObj?.id ? target : undefined;

        let from: Endpoint;
        if (startObj) {
          const aim = useTarget ? center(useTarget.rect) : end;
          from = {
            kind: 'attached',
            objectId: startObj.id,
            fallback: sideAnchor(startObj.rect, nearestSide(startObj.rect, aim)),
          };
        } else {
          from = { kind: 'free', x: startWorld.x, y: startWorld.y };
        }
        let to: Endpoint;
        if (useTarget) {
          const aim = startObj ? center(startObj.rect) : startWorld;
          to = {
            kind: 'attached',
            objectId: useTarget.id,
            fallback: sideAnchor(useTarget.rect, nearestSide(useTarget.rect, aim)),
          };
        } else {
          to = { kind: 'free', x: end.x, y: end.y };
        }
        undo?.boundary();
        const id = createConnector(doc, from, to, by);
        undo?.boundary();
        if (id) onCreated(id);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
    },
    [by, camera, doc, onCreated, rects, snapshot, undo],
  );

  useEffect(() => () => cleanupRef.current?.(), []);

  // Screen-space decorations: hover dots, drag preview and highlight dot.
  const z = camera.zoom || 1;
  const dot = CONNECTOR_DOT_RADIUS_PX;
  const decorations: React.JSX.Element[] = [];

  const showDotsFor = drag ? drag.startId ?? hoverId : hoverId;
  const hoverRect = showDotsFor ? rects.get(showDotsFor) : undefined;
  if (hoverRect && !drag) {
    for (const s of SIDES) {
      const p = worldToScreen(camera, sideAnchor(hoverRect, s));
      decorations.push(
        <div
          key={`dot-${s}`}
          data-testid="connector-dot"
          data-side={s}
          className="connector-dot"
          style={{
            position: 'absolute',
            left: p.x - dot,
            top: p.y - dot,
            width: dot * 2,
            height: dot * 2,
          }}
        />,
      );
    }
  }

  if (drag) {
    const startRect = drag.startId ? rects.get(drag.startId) : undefined;
    const startPt = startRect
      ? sideAnchor(startRect, nearestSide(startRect, drag.cursorWorld))
      : drag.startWorld;
    const targetRect = drag.targetId ? rects.get(drag.targetId) : undefined;
    const aim = startRect ? center(startRect) : drag.startWorld;
    const endPt = targetRect ? sideAnchor(targetRect, nearestSide(targetRect, aim)) : drag.cursorWorld;
    const sp = worldToScreen(camera, startPt);
    const ep = worldToScreen(camera, endPt);
    decorations.push(
      <svg
        key="preview"
        data-testid="connector-preview"
        className="connector-preview"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        <line
          x1={sp.x}
          y1={sp.y}
          x2={ep.x}
          y2={ep.y}
          stroke="var(--connector-stroke, #37352f)"
          strokeWidth={2}
          strokeDasharray="4 3"
        />
        <circle cx={sp.x} cy={sp.y} r={dot} className="connector-dot connector-dot-start" />
      </svg>,
    );
    if (targetRect) {
      const hp = worldToScreen(camera, endPt);
      decorations.push(
        <div
          key="highlight"
          data-testid="connector-dot-highlight"
          className="connector-dot connector-dot-highlight"
          style={{
            position: 'absolute',
            left: hp.x - dot * 1.5,
            top: hp.y - dot * 1.5,
            width: dot * 3,
            height: dot * 3,
          }}
        />,
      );
    }
  }

  return (
    <div
      ref={catcherRef}
      data-testid="connector-tool-catcher"
      className="tool-catcher"
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 5 }}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        if (drag) return;
        const el = catcherRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const w = screenToWorld(camera, { x: e.clientX - rect.left, y: e.clientY - rect.top });
        const under = objectAt(rects, snapshot, w);
        setHoverId(under?.id);
      }}
      onPointerLeave={() => {
        if (!drag) setHoverId(undefined);
      }}
    >
      {decorations}
    </div>
  );
}
