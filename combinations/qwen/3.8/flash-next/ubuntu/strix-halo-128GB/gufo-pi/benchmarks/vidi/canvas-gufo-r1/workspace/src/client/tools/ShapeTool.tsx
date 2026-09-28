import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { Doc } from 'yjs';
import { createShape } from '../../shared/objects/shape';
import { type ShapeKind } from '../../shared/config';

// Session ID for createdBy
const SESSION_ID = typeof crypto !== 'undefined' ? crypto.randomUUID() : 'unknown';

interface DragState {
  startScreen: { x: number; y: number };
  currentScreen: { x: number; y: number };
}

export function ShapeTool({
  kind,
  camera,
  doc,
  onCreated,
  onBoundary,
}: {
  kind: ShapeKind;
  camera: Camera;
  doc: Doc;
  onCreated: (id: string) => void;
  onBoundary?: () => void;
}) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not supported in jsdom */ }
    const drag = {
      startScreen: { x: e.clientX, y: e.clientY },
      currentScreen: { x: e.clientX, y: e.clientY },
    };
    dragRef.current = drag;
    setDragState(drag);
  }, []);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    d.currentScreen = { x: e.clientX, y: e.clientY };
    setDragState({ ...d });
  }, []);

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = null;
    setDragState(null);

    const start = screenToWorld(camera, d.startScreen);
    const end = screenToWorld(camera, d.currentScreen);
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    let x: number, y: number, w: number, h: number;

    // If the drag is too small, create at default size
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
      x = start.x;
      y = start.y;
      w = 160;
      h = 100;
    } else {
      x = Math.min(start.x, end.x);
      y = Math.min(start.y, end.y);
      w = Math.abs(dx);
      h = Math.abs(dy);
    }

    onBoundary?.();
    const rect = (dx !== 0 || dy !== 0) ? { x, y, width: w, height: h } : null;
    const id = createShape(doc, { kind, rect, at: start }, SESSION_ID);
    if (id) {
      onCreated(id);
    }
  }, [camera, doc, kind, onCreated, onBoundary]);

  return (
    <div
      data-testid="shape-tool-overlay"
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        cursor: 'crosshair',
        zIndex: 500,
        pointerEvents: 'auto',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Preview rect while dragging */}
      {dragState && (
        <svg
          style={{
            position: 'absolute',
            top: 0, left: 0,
            width: '100%', height: '100%',
            pointerEvents: 'none',
          }}
        >
          <rect
            x={Math.min(dragState.startScreen.x, dragState.currentScreen.x)}
            y={Math.min(dragState.startScreen.y, dragState.currentScreen.y)}
            width={Math.abs(dragState.currentScreen.x - dragState.startScreen.x)}
            height={Math.abs(dragState.currentScreen.y - dragState.startScreen.y)}
            fill="rgba(33,150,243,0.1)"
            stroke="#2196F3"
            strokeWidth={1}
            strokeDasharray="4 2"
          />
        </svg>
      )}
    </div>
  );
}
