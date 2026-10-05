/**
 * Object type registry (story 7). Each board object type registers a spec
 * declaring its component, resize rules, and hit-testing. Selection, move,
 * resize and delete behaviour stays generic — the registry only declares
 * per-type knobs (sel.all_types).
 */
import type { ComponentType } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import type { UndoController } from '../board/undo';

/** Props passed to every object component by the Board renderer. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  selected: boolean;
  editing: boolean;
  canEdit: boolean;
  /** When true, the object does not capture pointer events (text tool active). */
  pointerDisabled?: boolean;
  /** Delegate pointerdown to the transform gesture. */
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  /** Double-click handler (e.g. start editing). */
  onDoubleClick: (id: string) => void;
  /** The Y.Doc (needed for text editing). */
  doc?: Y.Doc;
  /** End editing callback. */
  onEndEdit?: (next: 'selected' | 'unselected') => void;
  /** Per-user undo controller (story 8). */
  undo?: UndoController | null;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /** Handle mode: 'all' shows 8 handles, 'horizontal' shows only e/w. Default 'all'. */
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (programming error).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/**
 * Get the spec for a registered object type, or undefined if unknown.
 */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// ─── Register sticky notes ───────────────────────────────────────────────────

import { StickyNote } from './StickyNote';

function stickyHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const w = obj.width ?? STICKY_SIZE_WORLD;
  const h = obj.height ?? STICKY_SIZE_WORLD;
  return (
    worldPoint.x >= obj.x &&
    worldPoint.x < obj.x + w &&
    worldPoint.y >= obj.y &&
    worldPoint.y < obj.y + h
  );
}

registerObjectType('sticky', {
  Component: StickyNote as unknown as ComponentType<ObjectProps>,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest: stickyHitTest,
});

// ─── Register text objects (story 9) ─────────────────────────────────────────

import { TextObject } from './TextObject';

function textHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const w = obj.width ?? 0;
  const h = obj.height ?? 0;
  return (
    worldPoint.x >= obj.x &&
    worldPoint.x < obj.x + w &&
    worldPoint.y >= obj.y &&
    worldPoint.y < obj.y + h
  );
}

registerObjectType('text', {
  Component: TextObject as unknown as ComponentType<ObjectProps>,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: textHitTest,
});

// ─── Register shape objects (story 10) ──────────────────────────────────────

import { ShapeObject } from './ShapeObject';
import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';

function shapeHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const w = obj.width ?? 160;
  const h = obj.height ?? 160;
  return (
    worldPoint.x >= obj.x &&
    worldPoint.x < obj.x + w &&
    worldPoint.y >= obj.y &&
    worldPoint.y < obj.y + h
  );
}

registerObjectType('shape', {
  Component: ShapeObject as unknown as ComponentType<ObjectProps>,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest: shapeHitTest,
});

// ─── Register connector objects (story 10) ──────────────────────────────────

import { ConnectorObject } from './ConnectorObject';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../shared/config';
import type { Endpoint } from '../../shared/geometry/connector-geometry';

function connectorHitTest(obj: ObjectSnapshot, worldPoint: Point, zoom: number = 1): boolean {
  const from = obj.from as Endpoint | undefined;
  const to = obj.to as Endpoint | undefined;
  if (!from || !to) return false;

  // For hit testing, we just use the stored from/to positions as a line
  // (the actual resolved endpoints would need the rects map, but for
  //  simple hit testing we use the bbox as a fallback)
  const w = obj.width ?? 0;
  const h = obj.height ?? 0;
  if (w === 0 && h === 0) return false;

  // Use the bbox for a quick reject, then check distance to the line
  const x1 = obj.x;
  const y1 = obj.y;
  const x2 = obj.x + w;
  const y2 = obj.y + h;

  const pts = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  const dist = distanceToPolyline(pts, worldPoint);
  return dist <= CONNECTOR_HIT_TOLERANCE_PX / zoom;
}

registerObjectType('connector', {
  Component: ConnectorObject as unknown as ComponentType<ObjectProps>,
  resizable: false,
  aspectLocked: false,
  minSize: 1,
  editableText: false,
  hitTest: (obj, p) => connectorHitTest(obj, p),
});

// ─── Register stroke objects (story 11) ─────────────────────────────────────

import { StrokeObject } from './StrokeObject';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import {
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
} from '../../shared/config';
import type { Camera } from '../canvas/camera';

/**
 * Select strokes by their line (pen.select): a hit only when the click is
 * within max(thickness/2, STROKE_HIT_TOLERANCE_PX / zoom) of the drawn line.
 * Clicks inside the bbox but farther from the line miss, so selection falls
 * through to the object underneath.
 */
function strokeHitTest(obj: ObjectSnapshot, worldPoint: Point, zoom: number = 1): boolean {
  const s = obj as StrokeSnap;
  if (!s.points || s.points.length === 0) return false;
  const thickness = PEN_THICKNESS_WORLD[s.thickness] ?? PEN_THICKNESS_WORLD.medium;
  const dist = distanceToPolyline(scaledPoints(s), worldPoint);
  return dist <= Math.max(thickness / 2, STROKE_HIT_TOLERANCE_PX / zoom);
}

registerObjectType('stroke', {
  Component: ((props: ObjectProps) => {
    const stroke = props.obj as StrokeSnap;
    const camera = (props as ObjectProps & { camera?: Camera }).camera;
    return (
      <StrokeObject
        stroke={stroke}
        selected={props.selected}
        camera={camera}
        onPointerDown={props.onPointerDown}
      />
    );
  }) as unknown as ComponentType<ObjectProps>,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  handles: 'all',
  hitTest: strokeHitTest,
});
