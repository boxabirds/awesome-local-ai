/**
 * Registers the `text` object type. Imported once at application startup.
 */

import { TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import { registerObjectType, defaultHitTest } from './registry';
import { TextObject } from './TextObject';

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: defaultHitTest,
});
