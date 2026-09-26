import type { ComponentType, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { ObjectSnapshot } from '@/shared/board-model';
import { objectBounds } from '@/shared/board-model';
import type { Point } from '@/shared/geometry';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '@/shared/config';
import { distanceToPolyline } from '@/shared/geometry/polyline';
import { StickyNote, type StickyNoteProps } from './StickyNote';
import { TextObject, type TextObjectProps } from './TextObject';
import { ShapeObject, type ShapeObjectProps } from './ShapeObject';
import { ConnectorObject, type ConnectorObjectProps } from './ConnectorObject';

/**
 * Object-type registry (story 7, sel.registry).
 *
 * The board renderer maps every snapshot object through `getObjectType` and
 * skips unknown types (forward compatibility: a doc persisted by a newer
 * build can carry types this build does not know). Select, move, resize and
 * delete all key off the spec, so stories 9-12 plug in a new object type by
 * registering one spec — they must not add their own selection or transform
 * code (sel.all_types).
 *
 * The module-level map is populated at import (sticky below); a duplicate
 * registration is a programming error and throws at module load.
 */

/**
 * Props the board renderer passes to every registry component. The base
 * fields are the object's own snapshot data plus the shared interaction
 * props; each component type may additionally receive type-specific props
 * (the renderer passes a superset; the index signature keeps this open).
 */
export type ObjectProps = Record<string, unknown> & {
  id: string;
  x: number;
  y: number;
  /** True when this object is in the local selection (drives the outline). */
  selected?: boolean;
  /**
   * Pointerdown delegation: the board's transform gesture selects the object
   * (or the set, when shift-held) and drives move/resize from here.
   */
  onObjectPointerDown?: (e: ReactPointerEvent<Element>) => void;
};

export interface ObjectTypeSpec {
  /** The component the renderer uses for objects of this type. */
  Component: ComponentType<ObjectProps>;
  /** Group resize (bounding-box handles) applies to this type. */
  resizable: boolean;
  /** Individual objects of this type keep their w:h ratio when resized. */
  aspectLocked: boolean;
  /** Smallest size (world units) one object of this type may be resized to. */
  minSize: number;
  /** Double-click / Enter enters in-place text editing for this type. */
  editableText: boolean;
  /**
   * Story 9: which resize handles the selection overlay shows for objects of
   * this type. 'all' (default) is the eight bounding-box handles; 'horizontal'
   * is e/w only (text objects: height always follows the content, and a
   * single-text e/w drag sets a fixed width instead of scaling the box).
   */
  handles?: 'all' | 'horizontal';
  /**
   * True when the world point is inside the object (hit testing).
   * `zoom` (story 10) converts screen-pixel tolerances to world units for
   * line-based types (connector.select); box types ignore it.
   */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Registers a type spec. Throws when the type is already registered. */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`registerObjectType: type '${type}' is already registered`);
  }
  registry.set(type, spec);
}

/** The spec for `type`, or undefined when this build does not know it. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Test-only: forget a registration (module state is per test process). */
export function resetObjectTypeRegistry(): void {
  registry.clear();
  // Re-register the built-ins (module load already did this once).
  registerStickyType();
  registerTextType();
}

function pointInBounds(obj: ObjectSnapshot, p: Point): boolean {
  const b = objectBounds(obj);
  return p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height;
}

/**
 * Thin adapter so the spec's `Component` (typed as `ComponentType<ObjectProps>`)
 * can be the concrete StickyNote without widening StickyNote's own props.
 */
function StickyRegistryComponent(props: ObjectProps): ReactElement {
  return <StickyNote {...(props as unknown as StickyNoteProps)} />;
}

export function registerStickyType(): void {
  if (registry.has('sticky')) return; // idempotent (resetObjectTypeRegistry)
  registry.set('sticky', {
    Component: StickyRegistryComponent,
    resizable: true,
    aspectLocked: true,
    minSize: STICKY_MIN_SIZE_WORLD,
    editableText: true,
    hitTest: pointInBounds,
  });
}

/** Thin adapter so the spec's `Component` can be the concrete TextObject. */
function TextRegistryComponent(props: ObjectProps): ReactElement {
  return <TextObject {...(props as unknown as TextObjectProps)} />;
}

export function registerTextType(): void {
  if (registry.has('text')) return; // idempotent (resetObjectTypeRegistry)
  registry.set('text', {
    Component: TextRegistryComponent,
    resizable: true,
    aspectLocked: false,
    minSize: TEXT_MIN_WIDTH_WORLD,
    editableText: true,
    handles: 'horizontal',
    hitTest: pointInBounds,
  });
}

/** Thin adapter so the spec's `Component` can be the concrete ShapeObject. */
function ShapeRegistryComponent(props: ObjectProps): ReactElement {
  return <ShapeObject {...(props as unknown as ShapeObjectProps)} />;
}

/**
 * Story 10: the shape type (shape.render). Registered by Board at module
 * load, NOT here: unit tests of this registry assert that 'shape' is
 * unknown in builds that never import the Board (TC-12 / forward
 * compatibility), so registration must not happen at this module's scope.
 */
export function registerShapeType(): void {
  if (registry.has('shape')) return; // idempotent
  registry.set('shape', {
    Component: ShapeRegistryComponent,
    resizable: true,
    aspectLocked: false,
    minSize: SHAPE_MIN_SIZE_WORLD,
    editableText: true,
    hitTest: pointInBounds,
  });
}

/** Thin adapter so the spec's `Component` can be the concrete ConnectorObject. */
function ConnectorRegistryComponent(props: ObjectProps): ReactElement {
  return <ConnectorObject {...(props as unknown as ConnectorObjectProps)} />;
}

/**
 * Story 10: the connector type (conn.render, connector.select). Hit test:
 * distance from the point to the centerline <= CONNECTOR_HIT_TOLERANCE_PX
 * screen pixels (converted to world units with `zoom`). Not box-resizable:
 * its ends move by dragging (setConnectorEndpoint).
 */
export function registerConnectorType(): void {
  if (registry.has('connector')) return; // idempotent
  registry.set('connector', {
    Component: ConnectorRegistryComponent,
    resizable: false,
    aspectLocked: false,
    minSize: 0,
    editableText: false,
    hitTest: (o, p, zoom) => {
      const from = o.fromPoint;
      const to = o.toPoint;
      if (from === undefined || to === undefined) return false;
      return distanceToPolyline([from, to], p) <= CONNECTOR_HIT_TOLERANCE_PX / (zoom ?? 1);
    },
  });
}

// Story 2's type is known from the start: register at module load.
registerStickyType();
// Story 9: free text (text.consistent: plugs in through the registry only).
registerTextType();
