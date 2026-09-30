// The object type registry (`sel.registry`).
//
// Everything story 7 does — drawing, selecting, marquee-selecting, moving,
// resizing, deleting — is written once against this table. A type declares only
// four things: how it is drawn, whether it can be resized, whether a resize keeps
// its proportions, and how small it may be made. Stories 9–12 add shapes,
// connectors, frames and images here and deliberately add no selection or
// transform code of their own: an object type that wants group behaviour has to
// register, and gets it for free (sel.all_types).
//
// Registering a client type also registers it in the shared model
// (`registerObjectTypeModel`), because a document can hold objects a screen cannot
// draw, and those must stay invisible rather than be moved or resized blindly
// (TC-08, TC-12).
import type { ComponentType, ReactNode } from 'react';
import type * as Y from 'yjs';
import type { BoardObject, ObjectSnapshot } from '../../shared/board-model';
import {
  isStickySnapshot,
  objectBounds,
  registerObjectTypeModel,
} from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { rectContains } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import type { UndoController } from '../board/undo';
import { StickyNote } from './StickyNote';

/** What the board hands every object component, whatever kind it is. */
export interface ObjectProps {
  object: BoardObject;
  doc: Y.Doc;
  /** Camera zoom: a gesture divides screen deltas by it to stay screen-relative. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False when the board could not be loaded: the board is read-only then. */
  editable: boolean;
  /**
   * A press on this object. The generic transform gesture decides what follows:
   * select if unselected, then move or resize (sel.transform). Object components
   * hold no pointer logic of their own.
   */
  onObjectPointerDown(event: PointerEvent, id: string): void;
  /** Only called for a type with `editableText`. */
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /**
   * This tab's own undo history (story 8). A text-editing object opens and closes a
   * step with it and routes Ctrl/Cmd+Z through it, so the browser's own textarea
   * undo never diverges from the shared text. Absent means the board is not undoable.
   */
  undo?: UndoController;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  /** False: no resize handles, and a handle gesture is ignored. */
  resizable: boolean;
  /** True: a resize keeps the proportions (sticky notes are squares). */
  aspectLocked: boolean;
  /** The type's own floor, in world units; the maximum is one global setting. */
  minSize: number;
  editableText: boolean;
  hitTest(object: ObjectSnapshot, worldPoint: Point): boolean;
}

const types = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. A duplicate throws: two modules quietly fighting over
 * one type name is a programming error, and it is cheaper to hear about it at
 * module load than to wonder why the wrong component drew.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (types.has(type)) {
    throw new Error(`object type "${type}" is already registered`);
  }
  types.set(type, spec);
  registerObjectTypeModel(type, spec.minSize);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return types.get(type);
}

/** Registered type names, for tests and for the "unknown type" cases. */
export function registeredObjectTypes(): string[] {
  return [...types.keys()];
}

/** A sticky note, reached through the generic props every object gets. */
function StickyObject(props: ObjectProps): ReactNode {
  if (!isStickySnapshot(props.object)) return null;
  return (
    <StickyNote
      note={props.object}
      doc={props.doc}
      zoom={props.zoom}
      selected={props.selected}
      editing={props.editing}
      editable={props.editable}
      onObjectPointerDown={props.onObjectPointerDown}
      onStartEdit={props.onStartEdit}
      onEndEdit={props.onEndEdit}
      undo={props.undo}
    />
  );
}

registerObjectType('sticky', {
  Component: StickyObject,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (object: ObjectSnapshot, point: Point) =>
    // A zero-size rect at the point: `rectContains` is the same rule the marquee
    // uses, so a hit is decided exactly like a marquee containment.
    rectContains(objectBounds(object), { ...point, width: 0, height: 0 }),
});
