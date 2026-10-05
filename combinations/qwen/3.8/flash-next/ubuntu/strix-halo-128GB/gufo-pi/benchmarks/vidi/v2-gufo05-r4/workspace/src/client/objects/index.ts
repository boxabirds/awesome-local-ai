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
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import { TEXT_OBJECT_TYPE } from '../../shared/objects/text';
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
  registerObjectType(TEXT_OBJECT_TYPE, {
    Component: TextObject,
    resizable: true,
    aspectLocked: false,
    minSize: TEXT_MIN_WIDTH_WORLD,
    editableText: true,
    handles: 'horizontal',
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
