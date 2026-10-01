import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { objectBounds } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import type { UndoController } from '../board/undo';

export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  editable: boolean;
  onPointerDown(e: React.PointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(): void;
  /** Per-user undo controller (story 8); used by text editors for boundaries. */
  undo?: UndoController;
  /**
   * Called when an object removes itself (story 9: a text object that ends
   * empty) so the selection no longer references it.
   */
  onClearSelection?(id: string): void;
}

export interface ObjectTypeSpec {
  Component: React.ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /**
   * Which resize handles the type shows when it is the only selected object
   * (story 9): 'all' (default) or 'horizontal' (e/w only — text height is
   * derived from the content).
   */
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Duplicate registration of object type: ${type}`);
  }
  registry.set(type, spec);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

export function getRegisteredTypes(): Set<string> {
  return new Set(registry.keys());
}

// Register the sticky note type
import { StickyNoteComponent } from './StickyNote';

registerObjectType('sticky', {
  Component: StickyNoteComponent,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
    const bounds = objectBounds(obj);
    return (
      worldPoint.x >= bounds.x &&
      worldPoint.x <= bounds.x + bounds.width &&
      worldPoint.y >= bounds.y &&
      worldPoint.y <= bounds.y + bounds.height
    );
  },
});

// Register the text type (story 9: first type added purely through the registry)
import { TextObjectComponent } from './TextObject';

registerObjectType('text', {
  Component: TextObjectComponent,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
    const bounds = objectBounds(obj);
    return (
      worldPoint.x >= bounds.x &&
      worldPoint.x <= bounds.x + bounds.width &&
      worldPoint.y >= bounds.y &&
      worldPoint.y <= bounds.y + bounds.height
    );
  },
});

// Register the shape type (story 10)
import { ShapeObjectComponent } from './ShapeObject';
import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';

registerObjectType('shape', {
  Component: ShapeObjectComponent,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
    const bounds = objectBounds(obj);
    return (
      worldPoint.x >= bounds.x &&
      worldPoint.x <= bounds.x + bounds.width &&
      worldPoint.y >= bounds.y &&
      worldPoint.y <= bounds.y + bounds.height
    );
  },
});

// Register the connector type (story 10)
import { ConnectorObjectComponent } from './ConnectorObject';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../shared/config';
import type { ConnectorEndpointSnap } from '../../shared/geometry/connector-geometry';

registerObjectType('connector', {
  Component: ConnectorObjectComponent as React.ComponentType<ObjectProps>,
  resizable: false,
  aspectLocked: false,
  minSize: 1,
  editableText: false,
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean {
    const z = zoom ?? 1;
    const conn = obj as unknown as { from: ConnectorEndpointSnap; to: ConnectorEndpointSnap };
    if (!conn.from || !conn.to) return false;

    const rects = new Map<string, { x: number; y: number; width: number; height: number }>();
    const { from, to } = resolveEndpoints({ from: conn.from, to: conn.to }, rects);
    const pts = [from, to];
    const dist = distanceToPolyline(pts, worldPoint);
    return dist <= CONNECTOR_HIT_TOLERANCE_PX / z;
  },
});
