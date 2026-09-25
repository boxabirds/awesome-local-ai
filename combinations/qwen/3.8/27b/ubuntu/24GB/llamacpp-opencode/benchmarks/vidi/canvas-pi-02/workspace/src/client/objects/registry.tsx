import * as React from 'react';
import * as Y from 'yjs';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../shared/config';
import { objectBounds } from '../../shared/board-model';
import { pointInRect } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../canvas/camera';
import { StickyNote } from './StickyNote';

/**
 * Board object registry (story 7, sel.registry).
 *
 * Each board object type registers its render component and the only
 * per-type knobs: whether it resizes, whether it keeps its proportions and
 * its minimum size. Selection, move, resize and delete stay generic
 * (sel.all_types): later object types (stories 9–12) call
 * `registerObjectType` and add no selection or transform code of their own.
 *
 * `StickyNote` imports only *types* from this module, so there is no runtime
 * import cycle: this module evaluates StickyNote first, then registers it.
 */
export interface ObjectProps {
  /** The snapshot object this element renders (cast to the type's snapshot). */
  obj: ObjectSnapshot;
  /** The live Y.Doc for direct Y.Text/Y.Map access (editing, swatches). */
  doc: Y.Doc;
  /** The current camera zoom (font fitting, scale-unscaled chrome). */
  zoom: number;
  /** Whether this object is in the current selection. */
  selected: boolean;
  /** Whether this object is in text editing (at most one object ever is). */
  editing: boolean;
  /** persist.client_status: false while the board is locked (view-only). */
  editable: boolean;
  /** Generic object press (story 7 transform gesture; window-level). */
  onObjectPointerDown: (e: PointerEvent, id: string) => void;
  /** Tab focus selects the object (so Enter can then edit it). */
  onSelect: (id: string) => void;
  /** Double-click / Enter: start text editing. */
  onStartEdit: (id: string) => void;
  /** The editor finished (blur / Escape / Enter): editing ends, selection kept. */
  onEndEdit: () => void;
}

export interface ObjectTypeSpec {
  /** Render component for every snapshot object of this type. */
  Component: React.ComponentType<ObjectProps>;
  /** Whether the selection shows resize handles for objects of this type. */
  resizable: boolean;
  /** Whether resizes keep the object's proportions (true for sticky). */
  aspectLocked: boolean;
  /** Smallest size the object may be resized to (world units). */
  minSize: number;
  /** Whether the object has an editable text (double-click / Enter). */
  editableText: boolean;
  /** True when the world point is inside the object's bounds. */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register one object type. Throws on duplicate registration (programming
 * error, caught by the registry unit tests).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) throw new Error(`object type already registered: ${type}`);
  registry.set(type, spec);
}

/** The spec for `type`, or undefined for unknown / unregistered types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** The types this build renders (the renderer skips everything else). */
export function registeredObjectTypes(): string[] {
  return [...registry.keys()];
}

// --- The first object type: sticky -----------------------------------------

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, worldPoint) => pointInRect(objectBounds(obj), worldPoint),
});

/** Default world-space size for objects that do not store one (sticky). */
export const DEFAULT_OBJECT_SIZE_WORLD = STICKY_SIZE_WORLD;
