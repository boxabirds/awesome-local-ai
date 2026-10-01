import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { normalizeRect, type Rect } from '../../shared/geometry';
import { createShape, squareRect, type ShapeKind } from '../../shared/objects/shape';
import type { UndoController } from '../board/undo';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { useForwardWheel } from './useForwardWheel';

const PRIMARY_BUTTON = 0;

interface Sizing { start: Point; current: Point; shift: boolean; pointerId: number }

/**
 * Full-board layer while the Shape tool is active. It owns the pointer gesture, so presses over existing objects
 * never move them. Escape is handled by the board (unmounting this layer discards an unfinished drag).
 */
export function ShapeTool(props: {
  kind: ShapeKind; camera: Camera; doc: Y.Doc; by: string; undo?: UndoController; onCreated(id: string): void;
}) {
  const { kind, camera, doc, by, undo } = props;
  const layer = useRef<HTMLDivElement>(null);
  useForwardWheel(layer);
  const [sizing, setSizing] = useState<Sizing | null>(null);
  const sizingRef = useRef<Sizing | null>(null);
  const set = (s: Sizing | null) => { sizingRef.current = s; setSizing(s); };

  const worldOf = (e: { clientX: number; clientY: number }): Point => {
    const r = layer.current?.getBoundingClientRect();
    return screenToWorld(camera, { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
  };
  const dragRect = (s: Sizing): Rect => (s.shift ? squareRect(s.start, s.current) : normalizeRect(s.start, s.current));

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.button ?? PRIMARY_BUTTON) !== PRIMARY_BUTTON) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = worldOf(e);
    set({ start: p, current: p, shift: e.shiftKey, pointerId: e.pointerId });
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = sizingRef.current;
    if (s && s.pointerId === e.pointerId) set({ ...s, current: worldOf(e), shift: e.shiftKey });
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = sizingRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const done = { ...s, current: worldOf(e), shift: e.shiftKey };
    set(null);
    undo?.boundary();
    // A click or a drag below the minimum size makes the standard shape; the model decides from the rect.
    const id = createShape(doc, { kind, rect: dragRect(done), at: done.start, square: done.shift }, by);
    undo?.boundary();
    if (id) props.onCreated(id);
  };

  const preview = sizing ? dragRect(sizing) : null;
  const tl = preview ? worldToScreen(camera, preview) : null;
  return (
    <div
      ref={layer}
      className="tool-layer shape-tool-layer"
      data-testid="shape-tool-layer"
      style={{ cursor: 'crosshair' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => set(null)}
    >
      {preview && tl && (
        <div
          className="shape-preview"
          data-testid="shape-preview"
          style={{ left: tl.x, top: tl.y, width: preview.width * camera.zoom, height: preview.height * camera.zoom }}
        />
      )}
    </div>
  );
}
