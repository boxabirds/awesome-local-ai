/**
 * Registers the `sticky` object type. Imported once at application startup.
 */

import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { registerObjectType, defaultHitTest } from './registry';
import { StickyNote } from './StickyNote';

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: defaultHitTest,
});
