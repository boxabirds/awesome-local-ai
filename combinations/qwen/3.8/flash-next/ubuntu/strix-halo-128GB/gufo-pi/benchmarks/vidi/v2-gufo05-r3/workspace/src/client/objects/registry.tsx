/**
 * The object-type registry (story 7).
 *
 * Every board object type the client can draw is registered here, once, together
 * with the handful of facts the selection code needs to know about it: whether
 * resizing keeps its proportions, how small it may get, whether it can be
 * resized at all, and how to tell whether a point falls inside it.
 *
 * Registering a type also tells the shared model (`board-model.ts`) that the
 * type is known, so "select all" and the marquee can only ever offer objects
 * this build can actually draw — an object from a later version stays put rather
 * than being moved, resized or deleted by a client that cannot render it.
 */
import type { ComponentType } from 'react';
import type * as Y from 'yjs';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  objectBounds,
  registerKnownObjectType,
  type ObjectSnapshot,
} from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import type { EndEditTarget } from '../board/useSelection';

/** What the object renders differently while it is selected. */
export interface SelectionContext {
  /** Part of the current selection: draw the outline. */
  selected: boolean;
  /** Its body holds the caret: render the live editor. */
  editing: boolean;
  /** A transform gesture is moving it. */
  dragging: boolean;
}

/** The props every object component receives from the viewport. */
export interface ObjectComponentProps {
  /** The board document, for the types that hold shared content (`Y.Text`). */
  doc: Y.Doc;
  snapshot: ObjectSnapshot;
  camera: Camera;
  selection: SelectionContext;
  /** Begin or end text editing. `null` ends it, keeping the selection. */
  onEditChange: (id: string, next: EndEditTarget | null) => void;
  /** Press on the object's body: select it, then move it. */
  onObjectPointerDown: (
    event: ReactPointerEvent | PointerEvent,
    snapshot: ObjectSnapshot,
  ) => void;
  /**
   * Close the current undo capture window and open a new one (story 8's `steps`).
   *
   * A gesture that writes from inside the object itself — dragging one end of an
   * arrow — has to say when it began and ended, or the whole drag would merge into
   * whatever happened next.
   */
  onUndoBoundary?: () => void;
}

export interface ObjectTypeSpec {
  /** The component that draws it and answers a press on its body. */
  readonly Component: ComponentType<ObjectComponentProps>;
  readonly resizable: boolean;
  /** Corner drags keep the width-to-height ratio (sticky notes do). */
  readonly aspectLocked: boolean;
  /** Double-click (and Enter, when it is the only selection) edits its text. */
  readonly editableText: boolean;
  /** The smallest side this type may be resized to, in world units. */
  readonly minSize: number;
  readonly hitTest: (obj: ObjectSnapshot, at: Point) => boolean;
  /** Which handles to show. Default 'all'; 'horizontal' shows only e/w. */
  readonly handles?: 'all' | 'horizontal';
}

/** The default hit test: the object's bounding rectangle, edges included. */
export function hitTestBounds(obj: ObjectSnapshot, at: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    at.x >= bounds.x &&
    at.x <= bounds.x + bounds.width &&
    at.y >= bounds.y &&
    at.y <= bounds.y + bounds.height
  );
}

const specs = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type under a name.
 *
 * Throws when the name is already taken: two components claiming one type is a
 * programming error that would otherwise silently decide the board's appearance
 * by import order.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (specs.has(type)) {
    throw new Error(`object type "${type}" is already registered`);
  }
  specs.set(type, spec);
  registerKnownObjectType(type);
}

/** The spec for a type, or `undefined` when this build cannot draw it. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return specs.get(type);
}

/** Every registered type name, for diagnostics and tests. */
export function registeredTypes(): string[] {
  return [...specs.keys()];
}
