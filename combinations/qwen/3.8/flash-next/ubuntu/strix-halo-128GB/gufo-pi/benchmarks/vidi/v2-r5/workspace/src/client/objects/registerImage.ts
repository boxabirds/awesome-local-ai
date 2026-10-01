/**
 * Registers the `image` object type. Imported once at application startup.
 */

import { IMAGE_MIN_SIZE_WORLD } from '../../shared/config';
import { registerObjectType, defaultHitTest } from './registry';
import { ImageObject } from './ImageObject';

registerObjectType('image', {
  Component: ImageObject,
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: defaultHitTest,
});
