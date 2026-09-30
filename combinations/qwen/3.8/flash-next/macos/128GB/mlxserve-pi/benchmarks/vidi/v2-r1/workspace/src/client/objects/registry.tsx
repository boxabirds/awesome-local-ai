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
  moveObjects,
  objectBounds,
  registerObjectTypeModel,
} from '../../shared/board-model';
import type { Handle, Point } from '../../shared/geometry';
import { rectContains } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import {
  readTextSnapshot,
  setTextBox,
  setTextWidthFixed,
} from '../../shared/objects/text';
import type { UndoController } from '../board/undo';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { boardMeasurer } from './textLayout';
import { measureTextBox } from './useTextBoxSync';

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

/**
 * The set of drag handles a kind of object has. `all` is story 7's eight handles
 * (a sticky note, whose height is its own). `horizontal` is for a type whose height
 * follows its content — a piece of text — which is dragged by west/east only.
 */
export type ObjectHandles = 'all' | 'horizontal';

/** What a type that measures its own box is told when a handle gesture happens. */
export interface ResizeNotice {
  /** The board's document, so the type can write its own box into it. */
  doc: Y.Doc;
  /** The single object this gesture is about. */
  id: string;
  /** Which handle is being dragged (`'e'` or `'w'` for a horizontal type). */
  handle: Handle;
  /** Where the pointer went down, in board units: the corner that did not move. */
  anchor: Point;
  /** The width the pointer asked for, already inside this type's own limits. */
  width: number;
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
  /** Which handles this kind of object is dragged by. Default `all`. */
  handles?: ObjectHandles;
  /**
   * The west/east handle of a `handles: 'horizontal'` type. The gesture never
   * writes a height for such a type: it hands over the width the pointer asked for
   * and the type works out how tall the text it holds has become.
   */
  onHorizontalResize?(event: ResizeNotice): void;
  /**
   * The gesture is over and this type measures its own box. The gesture drops its
   * live preview of the size and lets the type's own numbers stand, because the
   * client that made the change is the one that measured it (`text.wrap`).
   */
  remeasureAfterResize?(doc: Y.Doc, ids: string[]): void;
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

/**
 * A piece of free text, with the fields a generic snapshot cannot carry put back in.
 *
 * `snapshotObjects` reads coordinates, and coordinates are all a note needs. A text
 * object's characters live in a shared `Y.Text`, which no plain snapshot can hold,
 * so the component is handed the object as `readTextSnapshot` read it — the one
 * place in the client that asks the document for more than the generic read gives,
 * and the reason `TextObject` is handed `doc` like every other type.
 */
function TextObjectType(props: ObjectProps): ReactNode {
  const full = readTextSnapshot(props.doc, props.object.id);
  if (!full) return null;
  return <TextObject {...props} object={full} />;
}

registerObjectType('text', {
  Component: TextObjectType,
  resizable: true,
  // The width is what you drag; the height is what the text needs at that width.
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: (object: ObjectSnapshot, point: Point) =>
    rectContains(objectBounds(object), { ...point, width: 0, height: 0 }),

  // The gesture has worked out how wide the pointer wants the box, in board units
  // and already inside this type's own limits. It does not write anything for us:
  // taking the width, becoming fixed-width and keeping the edge that was not
  // grabbed where it was are all one write of ours.
  onHorizontalResize(notice): void {
    const { doc, id, handle, anchor } = notice;
    if (!setTextWidthFixed(doc, id, notice.width)) {
      // Already exactly this width: the only thing left is the position, and a west
      // handle that has not changed the width has not moved the box either.
      if (handle !== 'w') return;
    }
    const snapshot = readTextSnapshot(doc, id);
    if (!snapshot) return;
    // The stored width is the one that got clamped to this type's minimum, so it is
    // the one the fixed edge has to be measured from.
    const width = snapshot.width ?? TEXT_MIN_WIDTH_WORLD;
    if (handle === 'w') {
      moveObjects(doc, new Map<string, Point>([[id, { x: anchor.x - width, y: snapshot.y }]]));
    }
  },

  // The gesture is over. This type measures its own box, so its own numbers are the
  // ones that stay: the height the rewrapped text needs goes in now.
  remeasureAfterResize(doc: Y.Doc, ids: string[]): void {
    for (const id of ids) {
      const box = measureTextBox(doc, id, boardMeasurer);
      if (box) setTextBox(doc, id, box);
    }
  },
});
