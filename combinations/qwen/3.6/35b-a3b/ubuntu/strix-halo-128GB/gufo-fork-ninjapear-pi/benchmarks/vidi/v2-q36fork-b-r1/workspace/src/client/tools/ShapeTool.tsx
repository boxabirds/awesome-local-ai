import { useState, useCallback, useRef, type ReactNode } from 'react';
import * as Y from 'yjs';
import { screenToWorld, Camera, Point } from '@/client/canvas/camera';
import { createShape } from '@/shared/objects/shape';
import type { ShapeKind } from '@/shared/objects/shape';
import { SHAPE_MIN_SIZE_WORLD, DRAG_THRESHOLD_PX } from '@/shared/config';

interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  onCreated(id: string): void;
}

interface DragPreview {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Renders the shape-drawing preview overlay in the world layer. */
export function ShapeTool(props: ShapeToolProps): ReactNode {
  const { kind, camera, doc, onCreated } = props;

  const [dragState, setDragState] = useState<{
    startWorld: Point;
    previewScreen?: DragPreview;
    isActive: boolean;
  }>({ startWorld: { x: 0, y: 0 }, isActive: false });

  const lastPointerRef = useRef<Point | null>(null);
  const hasDraggedRef = useRef(false);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState.isActive) return;

      const cur = { x: e.clientX, y: e.clientY };
      lastPointerRef.current = cur;

      const dx = e.clientX - dragState.startWorld.x * camera.zoom + camera.x * camera.zoom;
      const dy = e.clientY - dragState.startWorld.y * camera.zoom + camera.y * camera.zoom;

      // Simpler: convert pointer position directly
      const ptrPos = screenToWorld(camera, { x: e.clientX, y: e.clientY });
      const prevPtrPos = lastPointerRef.current ? screenToWorld(camera, lastPointerRef.current) : null;

      if (prevPtrPos) {
        const pdx = e.clientX - lastPointerRef.current.x;
        const pdy = e.clientY - lastPointerRef.current.y;
        if (pdx * pdx + pdy * pdy > DRAG_THRESHOLD_PX ** 2) {
          hasDraggedRef.current = true;
        }
      }

      const sw = Math.abs(ptrPos.x - dragState.startWorld.x);
      const sh = Math.abs(ptrPos.y - dragState.startWorld.y);
      let sx = Math.min(dragState.startWorld.x, ptrPos.x);
      let sy = Math.min(dragState.startWorld.y, ptrPos.y);

      // Square constraint
      const shiftHeld = (e as unknown as MouseEvent).shiftKey;
      if (shiftHeld && (sw > 0 || sh > 0)) {
        const maxDim = Math.max(sw, sh);
        sx -= maxDim / 2;
        sy -= maxDim / 2;
        setDragState(prev => ({ ...prev, previewScreen: { x: sx, y: sy, width: maxDim, height: maxDim } }));
        return;
      }

      setDragState(prev => ({ ...prev, previewScreen: { x: sx, y: sy, width: sw, height: sh } }));
    },
    [camera, dragState.isActive, dragState.startWorld],
  );

  const handlePointerUpOrCancel = useCallback(() => {
    if (!dragState.isActive) return;

    const endWorld = lastPointerRef.current
      ? screenToWorld(camera, lastPointerRef.current)
      : dragState.startWorld;

    const sw = Math.abs(endWorld.x - dragState.startWorld.x);
    const sh = Math.abs(endWorld.y - dragState.startWorld.y);
    const isClick = sw < SHAPE_MIN_SIZE_WORLD || sh < SHAPE_MIN_SIZE_WORLD;

    const id = createShape(doc, {
      kind,
      rect: isClick ? null : { x: Math.min(dragState.startWorld.x, endWorld.x), y: Math.min(dragState.startWorld.y, endWorld.y), width: sw, height: sh },
      at: dragState.startWorld,
      square: hasDraggedRef.current,
    }, 'local');

    if (id) {
      onCreated(id);
    }

    setDragState({ startWorld: { x: 0, y: 0 }, isActive: false });
    hasDraggedRef.current = false;
  }, [camera, kind, doc, onCreated, dragState.isActive, dragState.startWorld]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      const wp = screenToWorld(camera, { x: e.clientX, y: e.clientY });
      setDragState({
        startWorld: wp,
        isActive: true,
      });
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      hasDraggedRef.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [camera],
  );

  // Convert world-space preview to SVG attributes in the transformed coordinate system
  const preview = dragState.previewScreen;

  return (
    <g
      data-testid="shape-tool-layer"
      style={{ transformOrigin: '0 0', transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
    >
      {preview && (
        <rect
          data-testid="shape-preview"
          x={preview.x}
          y={preview.y}
          width={Math.max(preview.width, 0)}
          height={Math.max(preview.height, 0)}
          fill="none"
          stroke="#2979ff"
          strokeWidth={1 / camera.zoom}
          strokeDasharray={`${4 / camera.zoom} ${4 / camera.zoom}`}
          className="shape-preview-rect"
        />
      )}
    </g>
  );
}
