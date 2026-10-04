import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import {
  STICKY_TYPE,
  objectBounds,
  registerObjectReader,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { rectContainsPoint, type Point } from '../../shared/geometry';
import type { EditEnd } from '../board/useSelection';
import { StickyNote } from './StickyNote';

/** A pointer event as it arrives from React or from the window. */
export type ObjectPointerEvent = ReactPointerEvent<HTMLElement> | PointerEvent;

/**
 * What the board hands an object component to draw it.
 *
 * Every object type is drawn from the same props: the object's own data plus what the board
 * knows that the object cannot know for itself - whether it is selected, whether it is being
 * typed in, how far away the camera is, and whether this person is allowed to write at all. The
 * three callbacks are the only way back out, and they are the board's generic gestures: this is
 * where a press goes to be turned into a move or a resize, whatever the object is.
 */
export interface ObjectProps {
  /** Plain data, from the board model's snapshot. */
  object: ObjectSnapshot;
  /** Operations go to the document, never to props or local state. */
  doc: Y.Doc;
  /** Current zoom, so screen movement can be turned into world movement. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * True while a move or resize gesture is carrying this object: the outline is drawn by the
   * selection overlay, and the object itself stops showing its toolbar mid-drag.
   */
  transforming: boolean;
  /**
   * Whether this object may be written to. False while the board could not be loaded: the object
   * can still be looked at and selected, but nothing here writes to the document, because what
   * is on screen is not known to be the board.
   */
  canEdit: boolean;
  /** A press on the object: selection, then a possible move (the transform gesture takes it). */
  onObjectPointerDown(event: ObjectPointerEvent, id: string): void;
  /** The browser taking pointer capture away mid-gesture (see story 2's notes on this). */
  onObjectLostPointerCapture(event: ObjectPointerEvent, id: string): void;
  onStartEdit(id: string): void;
  /** Escape keeps the object selected; a press outside it deselects. */
  onEndEdit(next: EditEnd): void;
}

/**
 * What the board needs to know about one object type, and the only thing it needs to know.
 *
 * Selection, moving, resizing and deleting are written once, for every type, in terms of an
 * object's box ({@link ObjectSnapshot}) and these few knobs: whether the type can be resized at
 * all, whether resizing keeps its proportions, how small and how big it may be, whether it has
 * text to type into, and whether a point hits it. Stories 9-12 add types by registering a
 * component and answering those questions - not by writing another gesture.
 */
export interface ObjectTypeSpec {
  /** The component that draws one object of this type. */
  Component: ComponentType<ObjectProps>;
  /** Whether the type shows resize handles at all. */
  resizable: boolean;
  /** Whether a resize keeps the width-to-height ratio (a sticky note stays square). */
  aspectLocked: boolean;
  /** Smallest width or height the type may be resized to, in world units. */
  minSize: number;
  /** Whether the object has text a person can type into (Enter opens it). */
  editableText: boolean;
  /** Whether `world` lies on this object; the marquee and future hit-testing use it. */
  hitTest(object: ObjectSnapshot, world: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. A duplicate is a programming error and throws: two specs for one
 * type would mean the board silently drawing one and resizing it by the other's rules, which is
 * a bug nobody would see until an object behaved differently on two screens.
 *
 * Registering a type also tells the board model to read objects of that type, so one call is
 * enough to make a new type appear on the board.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`the board object type "${type}" is already registered`);
  }
  registry.set(type, spec);
  registerObjectReader(type);
}

/** The spec of a type this client knows, or `undefined` for one it does not. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** The types this client can draw, in registration order. */
export function registeredObjectTypes(): readonly string[] {
  return [...registry.keys()];
}

/** A sticky note is a square that stays a square, and is the whole of its box. */
registerObjectType(STICKY_TYPE, {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (object, world) => rectContainsPoint(objectBounds(object), world),
});
