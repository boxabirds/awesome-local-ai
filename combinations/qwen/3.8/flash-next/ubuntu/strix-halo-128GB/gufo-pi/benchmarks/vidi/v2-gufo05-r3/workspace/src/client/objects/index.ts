/**
 * The object types this build ships, registered once at import time.
 *
 * Importing this module is what makes a type drawable *and* selectable: the
 * registry hands the renderer its component, and `registerObjectType` tells the
 * shared model the type is known so "select all" and the marquee can offer it.
 * A later story adds `registerObjectType('shape', shapeObjectType)` here and
 * needs no change to the selection, gesture or keyboard code.
 */
import { registerObjectType } from './registry';
import { stickyObjectType } from './sticky';

registerObjectType('sticky', stickyObjectType);

export * from './registry';
