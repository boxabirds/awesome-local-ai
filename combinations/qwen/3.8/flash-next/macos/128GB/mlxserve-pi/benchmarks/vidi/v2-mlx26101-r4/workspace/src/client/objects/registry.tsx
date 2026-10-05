/**
 * The registry of object types: what each type looks like, and what the board is
 * allowed to do to it.
 *
 * Everything the selection does — the handles it offers, whether a drag keeps the
 * proportions, how small a thing may go, whether Enter opens it for typing — is asked
 * of the type here rather than guessed from what happens to be selected. That is what
 * makes the story's promise ("the same behaviour for every object type") a property of
 * this file rather than of the sticky note: stories 9-12 add a `registerObjectType`
 * call and get selection, group moves, marquee, keyboard, deletion and the resize
 * limits for nothing, because nothing below this file knows what a sticky note is.
 *
 * The registry is deliberately not a `Map` of constructors to build: a type is
 * registered by name, once, and a second registration of the same name is a bug in the
 * code that is thrown at rather than silently overwriting how the board draws objects
 * people are looking at.
 */
import type { ComponentType } from 'react';
import type * as Y from 'yjs';

import { registerKnownObjectType } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import type { Handle, Rect } from '../../shared/geometry';
import { rectContains, type Point } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { resizeTextBox } from './textLayout';
import type { ObjectProps } from './objectProps';

export type { ObjectInteraction, ObjectProps } from './objectProps';

/**
 * Which handles a type offers.
 *
 * `all` is the eight a box has. `horizontal` is the two on either side, and it exists because a piece of
 * text has no height to drag: its height is counted in lines, so a handle that pulled it taller would be an
 * offer to do something that cannot be done — the words would fill the same lines the moment the pointer
 * let go. A type that cannot be resized at all offers none, which is what `resizable: false` already says.
 */
export type ResizeHandles = 'all' | 'horizontal';

/** The eight, in the order the overlay draws them. */
const ALL_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

/** The two that move a piece of text's words into fewer or more lines. */
const HORIZONTAL_HANDLES = ['e', 'w'] as const;

/** Every handle name a selection can offer, in the overlay's own order. */
export const RESIZE_HANDLES: Record<ResizeHandles, readonly Handle[]> = {
  all: ALL_HANDLES as readonly Handle[],
  horizontal: HORIZONTAL_HANDLES as readonly Handle[],
};

/** What the board can do to one type of object, and how it is drawn. */
export interface ObjectTypeSpec {
  /** The component that paints one object of this type, and handles its own text. */
  Component: ComponentType<ObjectProps>;
  /** False for a type that has one size: no handles are drawn for it at all. */
  resizable: boolean;
  /** True for a type whose width and height must keep their ratio (a note stays square). */
  aspectLocked: boolean;
  /** The smallest side this type accepts, in world units. */
  minSize: number;
  /** Whether Enter and a double-click open this type for typing. */
  editableText: boolean;
  /** Which handles this type answers to; every handle, unless it says otherwise. */
  handles?: ResizeHandles;
  /** Whether a world point lands on this object. A rotated shape overrides this later. */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
  /**
   * What a resize does to this type, when its box is not simply the box it is drawn at.
   *
   * The gesture hands over the rect the pointer has dragged to, and the type decides what its own box is.
   * A sticky note has none of this — its box is whatever it was told — but a piece of text takes the width,
   * lays its words inside it and counts the lines, so the height that comes out is not the height that went
   * in. Called once per frame per object, in the gesture's own write, so a type that measures has to be
   * quick about it.
   */
  resize?(doc: Y.Doc, id: string, rect: Rect): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Add an object type. Registering the same name twice is a programming mistake —
 * two components claiming to draw the same objects — so it throws rather than
 * letting the last module to be imported decide what the board looks like.
 *
 * Registering a type also tells the document model about it, so `snapshot` reports
 * objects of that type and the board can select, move and delete them; a type nobody
 * registered stays in the document unseen, which is how this build opens a board that
 * a later story wrote without being able to edit objects out of what it cannot draw.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (typeof type !== 'string' || type === '') throw new Error('An object type needs a name');
  if (registry.has(type)) throw new Error(`Object type "${type}" is already registered`);
  registry.set(type, spec);
  registerKnownObjectType(type);
}

/** The type as the board knows it, or `undefined` for a type this build cannot draw. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Every registered type name, for a settings screen or a test that wants them all. */
export function registeredObjectTypes(): string[] {
  return [...registry.keys()];
}

/**
 * Whether an object was clicked, asked of its type. An object of a type the board does
 * not know cannot be drawn, so it cannot be hit either.
 */
export function hitTestObject(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const spec = registry.get(obj.type);
  return spec ? spec.hitTest(obj, worldPoint) : false;
}

/**
 * What a whole selection permits, from the types inside it.
 *
 * The rules are the ones a person would guess without being told: a group that contains
 * something that cannot be resized cannot be resized (no handles at all, rather than
 * handles that do nothing to half the objects); a group that contains something that
 * must keep its proportions has them locked for the whole box, because one scale is
 * applied to the whole selection; and the handles belong to the smallest thing in the
 * group as much as to the largest, so nothing can be dragged below its own minimum.
 */
export function describeSelection(objects: readonly ObjectSnapshot[]): {
  resizable: boolean;
  aspectLocked: boolean;
  editableText: boolean;
  minSizes: number[];
  handles: readonly Handle[];
} {
  const minSizes: number[] = [];
  let resizable = objects.length > 0;
  let aspectLocked = false;
  let editableText = false;
  // The handles a group offers are the ones every object in it answers to: a selection of a note and a
  // piece of text is resized by the sides, because pulling the text taller is not a thing that can happen,
  // and the note is quite content to be resized from its sides too. The least capable object is the one
  // that decides, which is the same rule that decides the smallest minimum size and whether the box is
  // aspect-locked at all.
  let horizontalOnly = true;

  for (const object of objects) {
    const spec = registry.get(object.type);
    if (!spec) {
      // Should not happen — the snapshot does not contain types nobody registered —
      // but an object the board cannot describe is not a reason to offer handles that
      // would resize it by guesswork.
      resizable = false;
      minSizes.push(STICKY_SIZE_WORLD);
      continue;
    }
    resizable = resizable && spec.resizable;
    aspectLocked = aspectLocked || spec.aspectLocked;
    editableText = editableText || spec.editableText;
    // Only a group made entirely of things that cannot be pulled taller is drawn without the top and bottom
    // handles. A group that contains a note is resized as a box, and the objects inside it each do what they
    // can with the rect the pointer gives them — the note changes shape, the text takes the width and counts
    // its own lines. Taking the corners away from somebody resizing a note because a heading happens to be
    // in the way would be the text's limitation turned into the note's handicap.
    horizontalOnly = horizontalOnly && (spec.handles ?? 'all') === 'horizontal';
    minSizes.push(spec.minSize);
  }

  return {
    resizable,
    aspectLocked,
    editableText,
    minSizes,
    handles: RESIZE_HANDLES[resizable && horizontalOnly ? 'horizontal' : 'all'],
  };
}

/** The rectangle an object takes up, which is what a point is tested against. */
function rectHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  return rectContains(
    { x: obj.x, y: obj.y, width: obj.width, height: obj.height },
    { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 },
  );
}

/* ------------------------------------------------------------------ sticky -- */

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  // A note is square and stays square: an oblong sticky note is a different object.
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: rectHitTest,
});

/* ------------------------------------------------------------------ text -- */

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  // Text is not a shape, so it has no proportions to keep. What it does have is a height that belongs to
  // its words: dragging it taller would be dragging something that is decided elsewhere.
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  // Two handles rather than eight, for the same reason: see `ResizeHandles`.
  handles: 'horizontal',
  hitTest: rectHitTest,
  // The width is the person's, the height is the words'. One write, so one undo puts the drag back whole.
  resize: resizeTextBox,
});
