// Object type registry (story 7, sel.registry): the single per-type
// declaration that later object types (stories 9-12) plug into. Selection,
// move, resize, nudge and delete stay generic; a type only declares how it
// renders, whether it resizes, its aspect lock, minimum size, text editing
// and hit test (sel.all_types).

import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD, TEXT_SIZES } from '../../shared/config';
import type { TextSnapshot } from '../../shared/objects/text';
import type { UndoController } from '../board/undo';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

/** Props every board object component receives from the generic renderer. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  /** Camera zoom at render time (drag deltas are divided by it). */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** True while a transform gesture (group move/resize) is in progress. */
  dragging: boolean;
  /** Story 4 (persist.client_status): the board is locked (load failed). */
  locked: boolean;
  /** Generic transform gesture entry point (story 7, sel.transform). */
  onPointerDown(e: ReactPointerEvent, id: string): void;
  /** Selects this object alone (e.g. keyboard focus). */
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(): void;
  /** Story 9: clear the selection (a text editor ending on blur); sticky
   *  notes keep story 7's keep-selection behaviour and don't use this. */
  onClearSelection?(): void;
  /** Personal undo history (story 8): text editors use it for typing
   *  boundaries and in-editor Ctrl/Cmd+Z. */
  undo?: UndoController;
  /** Story 9: the text object's extended snapshot (size/widthMode); only
   *  text objects receive it. */
  note?: TextSnapshot;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
  /** Story 9: which resize handles a single selection of this type shows.
   *  'all' (default) is the story 7 bounding-box behaviour; 'horizontal'
   *  shows only the e/w handles, which set a fixed width (text.resize). */
  handles?: 'all' | 'horizontal';
}

const specs = new Map<string, ObjectTypeSpec>();

/**
 * Registers an object type. Calling this twice for the same type is a
 * programming error and throws (duplicate registration must be loud, not
 * silent — duplicate selection behaviour would be impossible to debug).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (specs.has(type)) {
    throw new Error(`object type "${type}" is already registered`);
  }
  specs.set(type, spec);
}

/** The spec for `type`, or undefined for an unknown type (D3). */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return specs.get(type);
}

// The sticky note type (story 2) is registered here: square (aspect locked),
// resizable down to STICKY_MIN_SIZE_WORLD, text-editable.
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  },
});

// The text type (story 9): not aspect-locked; a single text selection shows
// only the e/w handles (horizontal) which set a fixed width; a side-handle
// drag shrinks to TEXT_MIN_SIZE_WORLD (the shared min width).
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_SIZES.M, // the min width is enforced by setTextWidthFixed (TEXT_MIN_WIDTH_WORLD)
  editableText: true,
  handles: 'horizontal',
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  },
});
