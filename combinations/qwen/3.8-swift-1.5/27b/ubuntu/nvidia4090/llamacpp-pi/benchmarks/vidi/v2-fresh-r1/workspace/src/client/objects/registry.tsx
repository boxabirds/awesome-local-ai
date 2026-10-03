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
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';

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
  /** Hit test for marquee selection: is the object at `worldPoint`? */
  hitTest: (obj: ObjectSnapshot, worldPoint: Point) => boolean;
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
