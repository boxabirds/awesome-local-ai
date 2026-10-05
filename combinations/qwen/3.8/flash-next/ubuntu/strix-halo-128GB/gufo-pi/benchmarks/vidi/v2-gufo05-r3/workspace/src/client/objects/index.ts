/**
 * The object types this build ships, registered once at import time.
 *
 * Importing this module is what makes a type drawable *and* selectable: the
 * registry hands the renderer its component, and `registerObjectType` tells the
 * shared model the type is known so "select all" and the marquee can offer it.
 * Story 10 added the shape and the connector here, and needed no change to the
 * selection, gesture or keyboard code: registering a type is the extension point.
 */
import { registerObjectType } from './registry';
import { stickyObjectType } from './sticky';
import { textObjectType } from './text';
import { shapeObjectType } from './ShapeObject';
import { connectorObjectType } from './ConnectorObject';
import { strokeObjectType } from './StrokeObject';
import { imageObjectType } from './ImageObject';

registerObjectType('sticky', stickyObjectType);
registerObjectType('text', textObjectType);
registerObjectType('shape', shapeObjectType);
registerObjectType('connector', connectorObjectType);
registerObjectType('stroke', strokeObjectType);
registerObjectType('image', imageObjectType);

export * from './registry';
