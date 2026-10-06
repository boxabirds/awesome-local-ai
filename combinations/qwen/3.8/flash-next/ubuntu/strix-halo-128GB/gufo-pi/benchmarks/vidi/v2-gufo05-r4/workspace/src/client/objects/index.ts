/**
 * The object types this build knows about (story 7, `sel.registry`).
 *
 * One call per type, and this is the only module that makes those calls: a later story
 * adds a kind of object by adding a component and a line here, and gets selection,
 * marquee, bounding box, handles, group move, nudging and deleting for free.
 *
 * `registerObjectTypes` is a function rather than module side effects because it must run
 * before the first render and be safe to call twice (a StrictMode double render, or a test
 * that imports the board after something else already did).
 */

import { STICKY_OBJECT_TYPE } from '../../shared/board-model';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  STROKE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD
} from '../../shared/config';
import { CONNECTOR_OBJECT_TYPE } from '../../shared/objects/connector';
import { IMAGE_OBJECT_TYPE } from '../../shared/objects/image';
import { SHAPE_OBJECT_TYPE } from '../../shared/objects/shape';
import { STROKE_OBJECT_TYPE } from '../../shared/objects/stroke';
import { TEXT_OBJECT_TYPE } from '../../shared/objects/text';
import { ConnectorObject, connectorHitTest } from './ConnectorObject';
import { ImageObject } from './ImageObject';
import { ShapeObject } from './ShapeObject';
import { StrokeObject, strokeHitTest } from './StrokeObject';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { hitTestBounds, registerObjectType, registeredTypes } from './registry';

let registered = false;

/** Register every object type this build can draw. Calling it again does nothing. */
export function registerObjectTypes(): void {
  if (registered) return;
  registered = true;
  registerObjectType(STICKY_OBJECT_TYPE, {
    Component: StickyNote,
    // Sticky notes are resizable, always square (`sel.aspect`), and never smaller than
    // STICKY_MIN_SIZE_WORLD (`sel.size_limits`).
    resizable: true,
    aspectLocked: true,
    minSize: STICKY_MIN_SIZE_WORLD,
    editableText: true,
    hitTest: hitTestBounds
  });
  // Free text (story 9): resizable in width only. Its height is the lines its words wrap
  // into, so the selection offers its two side handles and not the other six, and its
  // smallest width is the smallest width a line of words can be given.
  // Shapes (story 10): resizable in every direction, and never smaller than the smallest box a
  // label can be read inside (`shape.style`, `sel.size_limits`). Its label is text the visitor
  // can type, so Enter and double-click edit it like a note's (`shape.label`).
  registerObjectType(SHAPE_OBJECT_TYPE, {
    Component: ShapeObject,
    resizable: true,
    aspectLocked: false,
    minSize: SHAPE_MIN_SIZE_WORLD,
    editableText: true,
    hitTest: hitTestBounds
  });
  // Connectors (story 10): an arrow is not a box, so it is the one type that cannot be resized
  // (`connector.reattach` moves its ends instead) and the one type that answers a click for
  // itself: near its line, in screen pixels, whatever the zoom (`connector.select`).
  registerObjectType(CONNECTOR_OBJECT_TYPE, {
    Component: ConnectorObject,
    resizable: false,
    aspectLocked: false,
    minSize: CONNECTOR_MIN_LENGTH_WORLD,
    editableText: false,
    hitTest: connectorHitTest
  });
  registerObjectType(TEXT_OBJECT_TYPE, {
    Component: TextObject,
    resizable: true,
    aspectLocked: false,
    minSize: TEXT_MIN_WIDTH_WORLD,
    editableText: true,
    handles: 'horizontal',
    hitTest: hitTestBounds
  });
  // Strokes (story 11): a drawing is an object like any other — moved, deleted, and resized in
  // proportion, because a sketch that squashed when you dragged a corner stops being the sketch
  // somebody drew (`pen.resize`). It holds no text. And like an arrow it answers a click for
  // itself, near its line rather than anywhere in its box, because the box of a scribble is mostly
  // nothing and the things underneath it still have to be reachable (`pen.select`).
  registerObjectType(STROKE_OBJECT_TYPE, {
    Component: StrokeObject,
    resizable: true,
    aspectLocked: true,
    minSize: STROKE_MIN_SIZE_WORLD,
    editableText: false,
    hitTest: strokeHitTest
  });
  // Images (story 12): resizable with aspect locked and a minimum size, no editable text,
  // hit test is the bounding box.
  registerObjectType(IMAGE_OBJECT_TYPE, {
    Component: ImageObject,
    resizable: true,
    aspectLocked: true,
    minSize: IMAGE_MIN_SIZE_WORLD,
    editableText: false,
    hitTest: hitTestBounds
  });
}

// The board's types exist as soon as this module is loaded, which is what lets any module
// render objects without remembering to initialise anything.
registerObjectTypes();

/** Has the board registered its types yet? (tests assert the fixture did not leak). */
export function isRegistered(type: string): boolean {
  return registeredTypes().includes(type);
}
