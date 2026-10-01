import { useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { ShapeKind } from '../../shared/board-model';
import { DRAG_THRESHOLD_PX } from '../../shared/config';
import { normalizeRect } from '../../shared/geometry';
import { createShape } from '../../shared/objects/shape';
import { localIdentityId } from '../board/identity';
import { useUndoController } from '../board/useUndo';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';
import { localPoint, useToolGesture } from './toolLayer';

interface Sizing { start: Point; cur: Point; shift: boolean }

/** The dragged screen rectangle; Shift makes it square from the start point, towards the pointer. */
export function sizingRect(g: Sizing): { x: number; y: number; width: number; height: number } {
  let end = g.cur;
  if (g.shift) {
    const side = Math.max(Math.abs(g.cur.x - g.start.x), Math.abs(g.cur.y - g.start.y));
    end = {
      x: g.start.x + (g.cur.x >= g.start.x ? side : -side), y: g.start.y + (g.cur.y >= g.start.y ? side : -side),
    };
  }
  return normalizeRect(g.start, end);
}

/** Drag to draw a shape of `kind`, click to drop a standard one; the new shape is handed to `onCreated`. */
export function ShapeTool(props: { kind: ShapeKind; camera: Camera; doc: Y.Doc; onCreated(id: string): void }) {
  const layer = useRef<HTMLDivElement>(null);
  const undo = useUndoController();
  const [sizing, setSizing] = useState<Sizing | null>(null);
  const latest = useRef({ ...props, undo });
  latest.current = { ...props, undo };
  const gesture = useRef<Sizing | null>(null);
  const set = (g: Sizing | null) => {
    gesture.current = g;
    setSizing(g);
  };

  useToolGesture(layer, {
    onDown: (e, viewport) => {
      const p = localPoint(viewport, e);
      set({ start: p, cur: p, shift: e.shiftKey });
      return true;
    },
    onMove: (e, viewport) => {
      const g = gesture.current;
      if (g) set({ ...g, cur: localPoint(viewport, e), shift: e.shiftKey });
    },
    onUp: (e, viewport) => {
      const g = gesture.current;
      set(null);
      if (!g) return;
      const { kind, camera, doc, onCreated, undo: u } = latest.current;
      const end: Sizing = { ...g, cur: localPoint(viewport, e), shift: e.shiftKey };
      const moved = Math.hypot(end.cur.x - g.start.x, end.cur.y - g.start.y) >= DRAG_THRESHOLD_PX;
      const r = sizingRect(end);
      const a = screenToWorld(camera, { x: r.x, y: r.y });
      const b = screenToWorld(camera, { x: r.x + r.width, y: r.y + r.height });
      u?.boundary();
      const id = createShape(doc, {
        kind,
        rect: moved ? { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y } : null,
        at: screenToWorld(camera, g.start),
        square: end.shift,
      }, localIdentityId());
      u?.boundary();
      if (id) onCreated(id);
    },
    onCancel: () => set(null),
  });

  const r = sizing ? sizingRect(sizing) : null;
  return (
    <div ref={layer} className="tool-layer" data-testid="shape-tool" data-tool-kind={props.kind}>
      {r && (
        <svg
          className="shape-preview"
          data-testid="shape-preview"
          style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
          viewBox={`0 0 ${Math.max(1, r.width)} ${Math.max(1, r.height)}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {props.kind === 'ellipse' ? (
            <ellipse cx={r.width / 2} cy={r.height / 2} rx={r.width / 2} ry={r.height / 2} />
          ) : props.kind === 'diamond' ? (
            <polygon points={`${r.width / 2},0 ${r.width},${r.height / 2} ${r.width / 2},${r.height} 0,${r.height / 2}`} />
          ) : (
            <rect x="0" y="0" width={r.width} height={r.height} />
          )}
        </svg>
      )}
    </div>
  );
}
