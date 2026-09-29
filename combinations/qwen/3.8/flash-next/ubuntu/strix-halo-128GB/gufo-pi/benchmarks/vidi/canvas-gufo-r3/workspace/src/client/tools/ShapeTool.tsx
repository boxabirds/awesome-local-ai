import React, { useCallback, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { Camera, Point } from '@client/canvas/camera';
import { screenToWorld } from '@client/canvas/camera';
import { normalizeRect } from '@shared/geometry';
import { createShape } from '@shared/objects/shape';
import type { ShapeKind } from '@shared/config';

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  /** Called with the new id after a shape is committed; the host selects it and returns to Select. */
  onCreated(id: string): void;
}

interface Drag {
  start: Point;
  current: Point;
  square: boolean;
}

/**
 * Full-viewport overlay while the Shape tool is active. It captures every pointer
 * event so drags over existing objects draw instead of moving them.
 * Click (or a drag below the minimum size) creates a standard shape centred on the
 * point; a drag sizes the shape; Shift constrains it to a square anchored at the
 * drag origin. The dashed preview is screen-space DOM and is never committed.
 */
export function ShapeTool(props: ShapeToolProps): React.ReactElement {
  const { kind, camera, doc, onCreated } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // Keep the latest commit callback reachable from the stable pointer handler.
  const commitRef = useRef<(at: Point, rect: { x: number; y: number; width: number; height: number }, square: boolean) => void>(() => {});

  const onCommit = useCallback(
    (at: Point, rect: { x: number; y: number; width: number; height: number }, square: boolean) => {
      const id = createShape(doc, { kind, rect, at, square }, 'user');
      if (id) onCreated(id);
    },
    [doc, kind, onCreated],
  );
  commitRef.current = onCommit;

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = rootRef.current?.getBoundingClientRect();
      const sx = clientX - (rect?.left ?? 0);
      const sy = clientY - (rect?.top ?? 0);
      return screenToWorld(camera, { x: sx, y: sy });
    },
    [camera],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const start = toWorld(e.clientX, e.clientY);
      const d: Drag = { start, current: start, square: e.shiftKey };
      dragRef.current = d;
      setDrag(d);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const cur = dragRef.current;
        if (!cur) return;
        const next = { ...cur, current: toWorld(ev.clientX, ev.clientY), square: ev.shiftKey };
        dragRef.current = next;
        setDrag(next);
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const cur = dragRef.current;
        dragRef.current = null;
        setDrag(null);
        if (!cur) return;
        const end = toWorld(ev.clientX, ev.clientY);
        const raw = normalizeRect(cur.start, end);
        commitRef.current(cur.start, raw, ev.shiftKey);
      };
      const onCancel = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        dragRef.current = null;
        setDrag(null);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toWorld],
  );

  // Screen-space dashed preview
  let preview: React.ReactElement | null = null;
  if (drag) {
    const rect = rootRef.current?.getBoundingClientRect();
    const cam = camera;
    const sx = (p: Point) => ({ x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom });
    const a = sx(drag.start);
    let b = sx(drag.current);
    if (drag.square) {
      const size = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      b = { x: a.x + Math.sign(b.x - a.x || 1) * size, y: a.y + Math.sign(b.y - a.y || 1) * size };
    }
    preview = (
      <div
        data-testid="shape-preview"
        style={{
          position: 'absolute',
          left: Math.min(a.x, b.x) + (rect?.left ?? 0) - (rect?.left ?? 0),
          top: Math.min(a.y, b.y),
          width: Math.abs(b.x - a.x),
          height: Math.abs(b.y - a.y),
          border: '2px dashed #1976D2',
          background: 'rgba(25,118,210,0.08)',
          pointerEvents: 'none',
        }}
      />
    );
  }

  return (
    <div
      ref={rootRef}
      data-testid="shape-tool-overlay"
      data-kind={kind}
      onPointerDown={handlePointerDown}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        cursor: 'crosshair',
        touchAction: 'none',
      }}
    >
      {preview}
    </div>
  );
}
