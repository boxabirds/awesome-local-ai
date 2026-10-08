/**
 * Shape tool (story 10, shape.tool_ui): a full-viewport layer that owns all
 * pointer input while the Shape tool is active.
 *
 * - Drag: a dashed screen-space preview follows the pointer (rect, ellipse
 *   or diamond outline); Shift constrains to a square (the larger dragged
 *   dimension, anchored at the drag origin). On release the shape is
 *   created with one `createShape` call and the tool returns to Select via
 *   `onCreated` (tools.return_to_select).
 * - Click (no drag / drag below SHAPE_MIN_SIZE_WORLD): the default
 *   SHAPE_DEFAULT_SIZE_WORLD square centred on the click point.
 * - pointercancel: nothing is created.
 *
 * The layer captures the pointer, so a drag that starts over an existing
 * object never moves it (TC-28).
 */
import {
  type JSX,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import {
  SHAPE_MIN_SIZE_WORLD,
  type ShapeKind,
} from '../../shared/config';
import { createShape } from '../../shared/objects/shape';
import type { Point, Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { CLIENT_ID } from '../client-id';

export interface ShapeToolProps {
  doc: Y.Doc;
  kind: ShapeKind;
  camera: Camera;
  /** tools.return_to_select: select the new id and switch to Select. */
  onCreated(id: string): void;
  /** Closes the undo capture window around the create (undo.boundaries). */
  onBoundary(): void;
}

interface Draft {
  origin: Point;
  pointerId: number;
}

/** The world rect for the current drag (zero size for a bare click). */
function draftRect(d: Draft, current: Point, shift: boolean): Rect {
  const width = Math.abs(current.x - d.origin.x);
  const height = Math.abs(current.y - d.origin.y);
  if (shift) {
    const size = Math.max(width, height);
    return { x: d.origin.x, y: d.origin.y, width: size, height: size };
  }
  return {
    x: Math.min(d.origin.x, current.x),
    y: Math.min(d.origin.y, current.y),
    width,
    height,
  };
}

/** True when the drag is below the minimum (the model makes it default). */
function isClick(rect: Rect): boolean {
  return rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD;
}

export function ShapeTool({ doc, kind, camera, onCreated, onBoundary }: ShapeToolProps): JSX.Element {
  const layerRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<Draft | null>(null);
  const [preview, setPreview] = useState<{ rect: Rect; shift: boolean } | null>(null);

  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = layerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return screenToWorld(camera, { x: clientX - rect.left, y: clientY - rect.top });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) {
      return;
    }
    const el = layerRef.current;
    if (el && typeof el.setPointerCapture === 'function') {
      el.setPointerCapture(e.pointerId);
    }
    const origin = toWorld(e.clientX, e.clientY);
    draftRef.current = { origin, pointerId: e.pointerId };
    setPreview({ rect: { x: origin.x, y: origin.y, width: 0, height: 0 }, shift: e.shiftKey });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = draftRef.current;
    if (d === null || e.pointerId !== d.pointerId) {
      return;
    }
    const current = toWorld(e.clientX, e.clientY);
    setPreview({ rect: draftRect(d, current, e.shiftKey), shift: e.shiftKey });
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = draftRef.current;
    if (d === null || e.pointerId !== d.pointerId) {
      return;
    }
    draftRef.current = null;
    setPreview(null);
    const current = toWorld(e.clientX, e.clientY);
    const rect = draftRect(d, current, e.shiftKey);
    onBoundary();
    const id = isClick(rect)
      ? createShape(doc, { kind, rect: null, at: d.origin }, CLIENT_ID)
      : createShape(doc, { kind, rect, at: d.origin, square: e.shiftKey }, CLIENT_ID);
    onBoundary();
    if (id !== null) {
      onCreated(id);
    }
  };


  const onCancel = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = draftRef.current;
    if (d === null || e.pointerId !== d.pointerId) {
      return;
    }
    draftRef.current = null;
    setPreview(null); // pointercancel: nothing created
  };

  // Screen-space preview geometry.
  let previewNodes: JSX.Element | null = null;
  if (preview !== null && preview.rect.width > 0 && preview.rect.height > 0) {
    const r = preview.rect;
    const p = {
      tl: worldToScreen(camera, { x: r.x, y: r.y }),
      tr: worldToScreen(camera, { x: r.x + r.width, y: r.y }),
      br: worldToScreen(camera, { x: r.x + r.width, y: r.y + r.height }),
      bl: worldToScreen(camera, { x: r.x, y: r.y + r.height }),
    };
    const common = {
      fill: 'none',
      stroke: '#1a73e8',
      strokeWidth: 1.5,
      strokeDasharray: '5 4',
    };
    if (kind === 'rect') {
      previewNodes = (
        <rect
          data-testid="shape-preview"
          x={p.tl.x}
          y={p.tl.y}
          width={p.br.x - p.tl.x}
          height={p.br.y - p.tl.y}
          {...common}
        />
      );
    } else if (kind === 'ellipse') {
      previewNodes = (
        <ellipse
          data-testid="shape-preview"
          cx={(p.tl.x + p.br.x) / 2}
          cy={(p.tl.y + p.br.y) / 2}
          rx={(p.br.x - p.tl.x) / 2}
          ry={(p.br.y - p.tl.y) / 2}
          {...common}
        />
      );
    } else {
      const mx = (p.tl.x + p.br.x) / 2;
      const my = (p.tl.y + p.br.y) / 2;
      previewNodes = (
        <polygon
          data-testid="shape-preview"
          points={`${mx},${p.tl.y} ${p.tr.x},${my} ${mx},${p.br.y} ${p.bl.x},${my}`}
          {...common}
        />
      );
    }
  }

  return (
    <div
      ref={layerRef}
      data-testid="shape-tool-layer"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 500,
        cursor: 'crosshair',
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={onCancel}
    >
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
        aria-hidden="true"
      >
        {previewNodes}
      </svg>
    </div>
  );
}
