/**
 * The props every object type is rendered with, and the interaction state a
 * transform gesture leaves for the object it holds.
 *
 * This lives apart from the registry so that an object component can import its own
 * props without importing the registry that imports it back: a sticky note knows what
 * it is given, not what else is on the board.
 *
 * The point of one props shape for every type is that the board's behaviour does not
 * have to be re-implemented per type: a sticky note, a shape and a drawing are all
 * pressed the same way, are selected the same way, and say when they are being edited
 * the same way. A type that has no text simply never calls `onStartEdit`.
 */
import type { PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';

import type { UndoActions } from '../board/undo';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Rect } from '../../shared/geometry';

/**
 * What the transform gesture is doing to the object under the pointer.
 *
 * `pressed` is before the drag threshold, `dragging` after it; `resizing` is a handle
 * of the selection box being dragged. It is rendered as `data-interaction` so a person
 * (and a test) can tell a click from a drag, and so a toolbar can get out of the way
 * while an object is being moved.
 */
export type ObjectInteraction = 'idle' | 'pressed' | 'dragging' | 'resizing';

export interface ObjectProps {
  /** The object as the document reports it: position, size, stacking, and its type's own fields. */
  object: ObjectSnapshot;
  /** The document the object is in. Objects write through the model, never to this prop. */
  doc: Y.Doc;
  /** Current zoom, for the few things an object sizes in screen pixels (text fit). */
  zoom: number;
  /**
   * Every object that has a surface, by id, as it is right now.
   *
   * One object's neighbours should not be any other object's business, and for almost every type it is not:
   * a note and a piece of text are drawn entirely out of their own fields. An arrow is the exception that
   * made this prop — its two ends are wherever *other objects* happen to be, and an arrow that had to go and
   * read the board to find out where it points would read the whole board once per arrow, on every frame of
   * a drag. Handed in by the board, which reads the objects once for everybody.
   */
  rects?: ReadonlyMap<string, Rect>;
  selected: boolean;
  /**
   * How many objects are selected in all. An object owns the controls that belong to *one* object — a
   * sticky note's colours, its bin — and those have to stand aside the moment the person is holding a
   * group, when the question is about the group and not about this one object any more.
   */
  selectedCount: number;
  /** Only ever true for the one object whose text is being edited, if it has any. */
  editing: boolean;
  /** A board that failed to load: nothing may be written to it. */
  readOnly: boolean;
  interaction: ObjectInteraction;
  /**
   * The pointer went down on this object. The board takes it from here: it decides
   * whether this is a selection, an addition to one, or the start of a group move, and
   * an object must not do any of that itself — that is how a group of objects came to
   * move as one layout in the first place.
   */
  onPointerDown(event: ReactPointerEvent<HTMLElement>, id: string): void;
  /** Put this object's text in front of the keyboard, if it has any. */
  onStartEdit(id: string): void;
  /** Take it out of front of the keyboard again. The selection is left as it is. */
  onEndEdit(): void;
  /**
   * This person's undo history, in the one form an object is given: the three calls that mark the edges
   * of an action, and the two that undo and redo the text inside this object while it is being typed in.
   *
   * Optional because an object can be drawn somewhere that has no history behind it — a preview, a
   * thumbnail, a board that never opened — and an object that cannot reach the history simply does not
   * close a capture window, which costs a merged step and nothing else.
   */
  undo?: UndoActions;
}
