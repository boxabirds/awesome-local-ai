/**
 * Registers the `shape` object type. Imported once at application startup.
 */

import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import { registerObjectType, defaultHitTest } from './registry';
import { ShapeObject } from './ShapeObject';

registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: defaultHitTest,
});
