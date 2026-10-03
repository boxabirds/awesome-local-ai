/**
 * The table that turns an object's `type` into the thing that draws it — the only
 * piece of client code that answers the question "what kind of object is this?".
 *
 * The registry exists so that `App` and `BoardLayout` never mention a concrete
 * object type (design.md): the app draws every object by looking its type up here
 * and rendering whatever component it finds, and the generic selection, move,
 * resize and delete code drives the same `ObjectProps` for every type. A type
 * nothing has registered is not drawn at all, which is what keeps an object from a
 * newer client off the screen (`sel.registry`), and because the selection and the
 * marquee are built from what the app can draw, such an object cannot be selected
 * either.
 *
 * Registering happens at module load, from the app's entry point. Tests that want
 * a second type register one themselves — see `tests/fixtures/testbox.tsx`.
 */
import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';

import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import { HANDLES, type HandleId } from '../../shared/geometry';
import type { Point } from '../canvas/camera';
import type { UndoController } from '../board/undo';
import { setTextWidthFixed, TEXT_TYPE } from '../../shared/objects/text';
import { SHAPE_TYPE } from '../../shared/objects/shape';
import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import { CONNECTOR_TYPE } from '../../shared/objects/connector';
import { connectorHitTest } from '../../shared/geometry/connector-geometry';
import { remeasureTextBox } from './useTextBoxSync';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';

/** What the board gives any object component, whatever its type. */
export interface ObjectProps {
  /** The object's stored state. Types with more fields narrow this themselves. */
  obj: ObjectSnapshot;
  /** The live document: components write through the model's mutators. */
  doc: Y.Doc;
  /** Current zoom, for anything that must keep a constant size on screen. */
  zoom: number;
  /** True while this object is in the selection; drives `data-selected`. */
  selected: boolean;
  /** True while this object is being text-edited, if it supports editing. */
  editing: boolean;
  /** Whether this board may write — false when the document failed to load. */
  canEdit: boolean;
  /** Press on the object: select it, and start moving/resizing it. */
  onObjectPointerDown(event: ReactPointerEvent<HTMLElement>, id: string): void;
  /** Keyboard focus reached the object: select it, if nothing else is. */
  onFocusSelect(id: string): void;
  /** Begin text editing this object, if its type supports it. */
  onStartEdit(id: string): void;
  /** Leave text editing, keeping the selection. */
  onEndEdit(): void;
  /**
   * This person's undo history, for a type that edits text in place.
   *
   * It is here rather than imported by the editor because the board owns one controller
   * per document: a type that opens an editor uses that same history, so typing into a
   * shape from story 10 is undone by the same Ctrl+Z as typing into a note (`undo.steps`).
   */
  undo?: UndoController;
}

/** One object type: how to draw it, and how far the generic code may take it. */
export interface ObjectTypeSpec {
  /** The component that draws one object of this type. */
  Component: ComponentType<ObjectProps>;
  /** False → no resize handles for a selection containing it. Default true. */
  resizable?: boolean;
  /** True → resize keeps the bounding box's proportions. Default false. */
  aspectLocked?: boolean;
  /** Smallest width or height, in world units. Default STICKY_MIN_SIZE_WORLD. */
  minSize?: number;
  /** True → Enter and double-click open a text editor. Default false. */
  editableText?: boolean;
  /**
   * Which handles this type may be resized by. Default: all eight.
   *
   * A type whose box has only one meaningful axis says so here: free text is given its
   * width by a drag and its height by its own lines, so it has an east and a west handle
   * and nothing on the top or the bottom. A selection offers the handles of anything in it
   * — see `handlesFor`.
   */
  handles?: readonly HandleId[];
  /**
   * Does a resize scale this type's height? Default true.
   *
   * False for a type whose height is whatever its content needs (`text.box`): dragging a
   * selection's corner moves it and widens it, and the height comes back from the lines —
   * stretching it would only be undone by the next measurement.
   */
  scalesHeight?: boolean;
  /**
   * A person dragged this type to a new width. Default: nothing beyond storing the number.
   *
   * For text this is the moment the box stops being measured and starts being chosen
   * (`text.resize_width`), which is a fact about the type that the generic resize gesture
   * has no business knowing.
   */
  onWidthResize?(doc: Y.Doc, id: string, width: number): void;
  /** Is this world point on the object? Default: is it inside its bounds. */
  hitTest?(obj: ObjectSnapshot, point: Point): boolean;
}

/** A spec with its optional capabilities resolved to their defaults. */
export interface ResolvedObjectType extends ObjectTypeSpec {
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  handles: readonly HandleId[];
  scalesHeight: boolean;
  onWidthResize(doc: Y.Doc, id: string, width: number): void;
  hitTest(obj: ObjectSnapshot, point: Point): boolean;
}

const registry = new Map<string, ResolvedObjectType>();

/** A point is on an object when it falls inside the rectangle it occupies. */
export function pointInBounds(obj: ObjectSnapshot, point: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

/**
 * Reject a blank or padded type name.
 *
 * A type name is an identifier written into the shared document and looked up by exact
 * match, so a padded one would be registered under a name no document can ever hold —
 * invisible from then on. Better to fail where the mistake is made.
 */
function assertTypeName(type: string): void {
  if (type.trim() === '' || type !== type.trim()) {
    throw new Error(`an object type name cannot be blank or padded: "${type}"`);
  }
}

/** Reject a second registration of a name: silently replacing it loses objects. */
function assertUnused(type: string): void {
  if (registry.has(type)) throw new Error(`object type "${type}" is already registered`);
}

/**
 * Add an object type to the table. Call it once per type, at module load.
 *
 * Throws if the name is blank, or already taken — by a previous call or by the
 * app's own types, so a test that registers a second type cannot accidentally
 * shadow a sticky note.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  assertTypeName(type);
  assertUnused(type);
  registry.set(type, {
    ...spec,
    resizable: spec.resizable ?? true,
    aspectLocked: spec.aspectLocked ?? false,
    minSize: spec.minSize ?? STICKY_MIN_SIZE_WORLD,
    editableText: spec.editableText ?? false,
    handles: spec.handles ?? HANDLES,
    scalesHeight: spec.scalesHeight ?? true,
    onWidthResize: spec.onWidthResize ?? (() => {}),
    hitTest: spec.hitTest ?? pointInBounds,
  });
}

/** The spec registered under `type`, or undefined if nothing has been. */
export function getObjectType(type: string): ResolvedObjectType | undefined {
  return registry.get(type);
}

/** Does this object's type have a component, so the app can draw it at all? */
export function isRenderable(type: string): boolean {
  return registry.has(type);
}

/**
 * The handles a selection may show: the ones anything in it is resized by.
 *
 * One text on its own has two handles, because that is all the box it has. Put a sticky
 * note next to it and the other six come back — the note is resized by them, and a person
 * selecting both reasonably expects to resize both. What a handle then *does* to each
 * object is that object's business (`scalesHeight`), not the handle's.
 */
export function handlesFor(objects: readonly ObjectSnapshot[]): readonly HandleId[] {
  const offered: HandleId[] = [];
  for (const handle of HANDLES) {
    if (objects.some((object) => (registry.get(object.type)?.handles ?? HANDLES).includes(handle))) {
      offered.push(handle);
    }
  }
  return offered;
}

// The types the app ships with. Later stories add their own lines here, and the
// selection, transform and delete code above needs no change for them.
registerObjectType('sticky', {
  Component: StickyNote,
  // A note is a square piece of paper: resizing it may only ever produce a square.
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
});

registerObjectType(TEXT_TYPE, {
  Component: TextObject,
  // Width only: the height is however tall the wrapped lines turned out (`text.box`), so
  // there is nothing for a north or south handle to grab.
  handles: ['w', 'e'],
  scalesHeight: false,
  // A width a person dragged is a width they chose (`text.resize_width`): the box stops
  // measuring itself and wraps inside that number. The measure belongs in this callback
  // rather than being left to the box's own listener, because the last frame of a drag
  // writes the width the frame before it already wrote: nothing changes, so a listener that
  // only reacts to change never fires, and the height left standing is the one from before
  // the words had to wrap.
  onWidthResize: (doc, id, width) => {
    setTextWidthFixed(doc, id, width);
    remeasureTextBox(doc, id);
  },
  // The narrowest a column of text can be before it is a single letter per line.
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
});

registerObjectType(SHAPE_TYPE, {
  // The component narrows `obj` to a shape snapshot; the registry hands every type the
  // same `ObjectProps`, and the board only ever renders a shape from a shape snapshot.
  Component: ShapeObject as unknown as ComponentType<ObjectProps>,
  // A shape is resized freely in both axes down to the smallest box the drag tool accepts.
  minSize: SHAPE_MIN_SIZE_WORLD,
  // Double-click and Enter open its centred label (`shape.label`).
  editableText: true,
});

registerObjectType(CONNECTOR_TYPE, {
  Component: ConnectorObject as unknown as ComponentType<ObjectProps>,
  // An arrow has no box of its own to resize: it is wherever its two ends are. So it
  // offers no handles, and a lone selected arrow shows its re-attach dots instead
  // (`connector.readjust`).
  resizable: false,
  handles: [],
  // A click lands on an arrow by how close it is to the line, not to its bounding box —
  // a nearly-straight arrow has almost no box to be inside. The registry signature has no
  // zoom, so this is the zoom-1 form; the app hits-tests the live line at the real zoom.
  hitTest: (obj, point) => connectorHitTest(obj as never, point, 1),
});
