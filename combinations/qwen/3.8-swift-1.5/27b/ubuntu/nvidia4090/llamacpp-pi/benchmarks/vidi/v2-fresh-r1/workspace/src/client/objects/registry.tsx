// Object type registry (story 7).
// Each object type registers a render component plus its interaction spec.
// The board renderer and the transform gesture consult the registry, so new
// object types plug in without touching board code.

import type {
  ComponentType,
  PointerEvent as ReactPointerEvent,
} from 'react';
import * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { rectContains, type Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD, SHAPE_MIN_SIZE_WORLD, CONNECTOR_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';
import { StrokeObject } from './StrokeObject';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { hitStroke, type StrokeSnap } from '../../shared/objects/stroke';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';

/** Props every object component receives from the board renderer. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** Delegated to the shared transform gesture (pointerdown on the object). */
  onObjectPointerDown: (e: ReactPointerEvent<Element>, id: string) => void;
  /** Double-click: enter edit mode if the type supports it. */
  onObjectDoubleClick: (id: string) => void;
  /** End text editing (Escape / click outside). Selection state is kept. */
  onEndEdit: () => void;
  /** Undo boundary callback (story 8). */
  onBoundary?: () => void;
  /** Undo callback for text editor (story 8). */
  onUndo?: () => void;
  /** Redo callback for text editor (story 8). */
  onRedo?: () => void;
  /**
   * Story 11: pointer landed on this object's footprint but missed its
   * line (stroke bbox fall-through). The board selects the object
   * underneath, or clears the selection.
   */
  onObjectMiss?: (e: ReactPointerEvent<Element>, id: string) => void;
}

export interface ObjectTypeSpec {
  /** The render component. */
  Component: ComponentType<ObjectProps>;
  /** Whether the type can be resized (resize handles shown when selected). */
  resizable: boolean;
  /** Whether the type keeps its aspect ratio (stickies are squares). */
  aspectLocked: boolean;
  /** Minimum width/height in world units (resize clamp). */
  minSize: number;
  /** Whether double-click / Enter opens a text editor. */
  editableText: boolean;
  /**
   * Which resize handles to show when this object is the sole selection
   * (story 9): 'all' (default) or 'horizontal' (text: e/w only).
   */
  handles?: 'all' | 'horizontal';
  /**
   * Hit test: is the object at `worldPoint`? `zoom` lets types scale their
   * tolerance to screen pixels (story 11 stroke line hit test).
   */
  hitTest: (obj: ObjectSnapshot, worldPoint: Point, zoom: number) => boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (a programming
 * error that should surface immediately in tests and dev).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/** Look up an object type's spec, or undefined if unregistered. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Point-in-rect hit test for objects with an explicit bounding rect. */
function rectHitTest(obj: ObjectSnapshot, p: Point): boolean {
  const r = objectBounds(obj);
  return rectContains(r, { x: p.x, y: p.y, width: 0, height: 0 });
}

// --- Built-in types ---

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: rectHitTest,
});

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: rectHitTest,
});

registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: rectHitTest,
});

registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest: (obj: ObjectSnapshot, p: Point, _zoom: number) => {
    // Connector hit test: distance to the line <= tolerance
    const conn = obj as ObjectSnapshot & { from: { kind: string; objectId?: string; fallback?: Point; x?: number; y?: number }; to: { kind: string; objectId?: string; fallback?: Point; x?: number; y?: number } };
    if (!conn.from || !conn.to) return false;
    // Simple point check for now (full resolution needs rects map)
    const fx = conn.from.kind === 'free' ? conn.from.x! : conn.from.fallback?.x ?? obj.x;
    const fy = conn.from.kind === 'free' ? conn.from.y! : conn.from.fallback?.y ?? obj.y;
    const tx = conn.to.kind === 'free' ? conn.to.x! : conn.to.fallback?.x ?? obj.x + (obj.width ?? 0);
    const ty = conn.to.kind === 'free' ? conn.to.y! : conn.to.fallback?.y ?? obj.y;
    const dist = distanceToPolyline([{ x: fx, y: fy }, { x: tx, y: ty }], p);
    return dist <= CONNECTOR_HIT_TOLERANCE_PX;
  },
});

registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  // Select by the line: only clicks within max(thickness/2,
  // STROKE_HIT_TOLERANCE_PX / zoom) of the drawn line hit the stroke;
  // clicks inside the bbox but farther away fall through to the objects
  // below.
  hitTest: (obj: ObjectSnapshot, p: Point, zoom: number) =>
    hitStroke(obj as StrokeSnap, p, zoom),
});
