/**
 * Object type registry (story 7).
 *
 * The board itself — selection, marquee, group move, resize, delete, keyboard —
 * is written once against `ObjectSnapshot`. A concrete object type contributes
 * exactly two things: the component that draws it, and its size and behaviour
 * rules. Adding a type means calling `registerObjectType`, nothing else.
 */
import type { FC, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds, registerKnownObjectType } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { isFinitePointValue } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';

/** Props every board object component receives. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  /** Current zoom, for screen-constant UI such as toolbars. */
  zoom: number;
  /** The object is part of the current selection. */
  selected: boolean;
  /** The object is the only one selected. */
  soleSelected: boolean;
  /** This object's text editor is open. */
  editing: boolean;
  /** A group move or resize is in flight. */
  transforming: boolean;
  /** Board is read-only (story 4). */
  editable: boolean;
  /** Select and start the shared transform gesture. */
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  onStartEdit(id: string): void;
  /** Close the text editor; 'unselected' also clears the selection. */
  onEndEdit(next?: 'selected' | 'unselected'): void;
}

export interface ObjectTypeSpec {
  /** Draws one object and delegates its pointer-down to `onObjectPointerDown`. */
  Component: FC<ObjectProps>;
  /** Whether the selection shows resize handles for this type. */
  resizable: boolean;
  /** Whether a locked corner drag keeps the width-to-height ratio. */
  aspectLocked: boolean;
  /** Smallest edge, in world units. */
  minSize: number;
  /** Whether the type has a text editor. */
  editableText: boolean;
  /** Precise hit test in world units; the rectangle rule is enough for most types. */
  hitTest(obj: ObjectSnapshot, p: Point): boolean;
}

const specs = new Map<string, ObjectTypeSpec>();

/**
 * Registers an object type. Throws when the key is already taken, so two
 * stories cannot quietly overwrite each other's rules.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (typeof type !== 'string' || type === '') {
    throw new Error('registerObjectType: the type key must be a non-empty string');
  }
  if (specs.has(type)) {
    throw new Error(`registerObjectType: object type "${type}" is already registered`);
  }
  if (!spec || !spec.Component || typeof spec.hitTest !== 'function') {
    throw new Error(`registerObjectType: spec for "${type}" needs a Component and a hitTest`);
  }
  specs.set(type, spec);
  // The document model only reads and selects types it knows about.
  registerKnownObjectType(type);
}

/** The rules for `type`, or undefined when this build does not know it. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return specs.get(type);
}

/** Rectangle hit test, the rule for every rectangular type. */
export function pointInBounds(obj: ObjectSnapshot, p: Point): boolean {
  if (!isFinitePointValue(p)) return false;
  const b = objectBounds(obj);
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
}

/** A sticky note: resizable, always square, with editable text. */
registerObjectType('sticky', {
  Component: StickyNote as unknown as FC<ObjectProps>,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: pointInBounds,
});
