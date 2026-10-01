// Object type registry: maps type strings to their rendering component
// and declarative interaction properties.
//
// The only per-type knobs are: whether it can be resized, whether it keeps
// its proportions, its minimum size, whether it has editable text, and how
// to hit-test a world point. Selection, move, resize and delete stay generic.

import type * as React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';

/** Props that every object-type component receives. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: import('yjs').Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  canEdit: boolean;
  onPointerDown(e: React.PointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/** Declarative per-type specification for the generic machinery. */
export interface ObjectTypeSpec {
  /** React component that renders this object type. */
  Component: React.ComponentType<ObjectProps>;
  /** Whether the type can be resized by handle. */
  resizable: boolean;
  /** Whether resizing keeps the original aspect ratio. */
  aspectLocked: boolean;
  /** Minimum width/height in world units after resize. */
  minSize: number;
  /** Whether double-click opens a text editor. */
  editableText: boolean;
  /** Hit-test: is `worldPoint` within this object's bounds? */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws if the type name is already registered
 * (a duplicate registration is a programming error).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type '${type}' is already registered`);
  }
  registry.set(type, spec);
}

/**
 * Get the spec for a registered type, or undefined for unknown types.
 */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// --- Register sticky notes ---------------------------------------------------

// Lazy import to avoid circular dependency issues at module load time.
// The StickyNote component is loaded separately; here we provide a placeholder
// component that the real module replaces.

function StickyNotePlaceholder(): React.ReactElement {
  return <div data-sticky-placeholder={true} /> as React.ReactElement;
}

registerObjectType('sticky', {
  Component: StickyNotePlaceholder,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
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
