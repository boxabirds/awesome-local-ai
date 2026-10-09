import { useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type * as Y from 'yjs';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import type { ShapeKind } from '../../shared/objects/shape';
import { createShape } from '../../shared/objects/shape';
import type { UndoController } from '../board/undo';

/**
 * Story 10 (shapes): the Shape tool's screen-space layer.
 *
 * Drag → a dashed preview rectangle; on release the shape is created
 * (createShape: below-min drags and clicks make a SHAPE_DEFAULT_SIZE_WORLD
 * square at the click point; Shift makes the rect a square). pointercancel
 * and Escape (the tool unmounts) create nothing. The tool returns to Select
 * after a creation (via onCreated → useActiveTool.toolCreated).
 */
export function ShapeTool(props: {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  undo: UndoController;
  by: string;
  onCreated(id: string): void;
}): ReactElement {
  const { kind, camera, doc, undo, by, onCreated } = props;
  const layerRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ client: Point; world: Point; pointerId: number } | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;

  const toLocal = (e: { clientX: number; clientY: number }): Point => {
    const rect = layerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const previewRect = (cur: Point, shift: boolean): Rect => {
    const s = startRef.current!;
    const r = normalizeRect(s.world, cur);
    if (!shift) return r;
    // The square anchors at the corner the drag origin touches.
    const size = Math.max(r.width, r.height);
    return {
      x: cur.x <= s.world.x ? s.world.x - size : s.world.x,
      y: cur.y <= s.world.y ? s.world.y - size : s.world.y,
      width: size,
      height: size,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = layerRef.current;
    if (el && typeof el.setPointerCapture === 'function') el.setPointerCapture(e.pointerId);
    startRef.current = { client: toLocal(e), world: screenToWorld(camera, toLocal(e)), pointerId: e.pointerId };
    setPreview(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = startRef.current;
    if (!s) return;
    setPreview(previewRect(screenToWorld(camera, toLocal(e)), e.shiftKey));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = startRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    startRef.current = null;
    setPreview(null);
    const cur = screenToWorld(camera, toLocal(e));
    const rect = normalizeRect(s.world, cur);
    const isClick =
      rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD;
    // One undo step for the creation (story 8).
    undo.boundary();
    const id = createShape(
      doc,
      isClick
        ? { kind, rect: null, at: s.world }
        : { kind, rect, at: s.world, square: e.shiftKey },
      by,
    );
    if (id === null) return;
    undo.boundary();
    onCreated(id);
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    if (startRef.current && e.pointerId === startRef.current.pointerId) {
      startRef.current = null;
      setPreview(null); // nothing is created
    }
  };

  const pv = preview;
  const pvScreen = pv ? worldToScreen(camera, { x: pv.x, y: pv.y }) : null;

  return (
    <div
      ref={layerRef}
      data-shape-tool-layer="true"
      style={{
        position: 'absolute',
        inset: 0,
        cursor: 'crosshair',
        zIndex: 15,
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {pv && pvScreen && (
        <div
          data-shape-preview="true"
          style={{
            position: 'absolute',
            left: pvScreen.x,
            top: pvScreen.y,
            width: pv.width * camera.zoom,
            height: pv.height * camera.zoom,
            border: '1.5px dashed #1a73e8',
            background: 'rgba(26,115,232,0.06)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
