import { StickyNote } from './StickyNote';
import {
  StickyTextEditor,
} from './StickyTextEditor';
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
  fitFontSize,
} from './StickyText';
import {
  registerObjectType,
  getObjectType,
  getAllTypes,
} from './registry';
export { StickyNote, StickyTextEditor, clampToLimit, applyTextDiff, counterVisible, fitFontSize };
export { registerObjectType, getObjectType, getAllTypes };
export type { ObjectTypeSpec } from './registry';

import type { ObjectTypeSpec } from './registry';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '@shared/config';
import type { StickySnapshot } from '@shared/board-model';
import type { Point } from '../canvas/camera';
import { objectBounds } from '@shared/board-model';

// Register 'sticky' as a known object type (side effect on import)
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest(obj: StickySnapshot, pt: Point): boolean {
    const b = objectBounds(obj);
    return (
      pt.x >= b.x &&
      pt.y >= b.y &&
      pt.x <= b.x + b.width &&
      pt.y <= b.y + b.height
    );
  },
});
