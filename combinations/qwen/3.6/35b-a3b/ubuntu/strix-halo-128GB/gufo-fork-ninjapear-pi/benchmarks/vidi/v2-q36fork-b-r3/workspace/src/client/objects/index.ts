import { StickyNote } from './StickyNote';
import { StickyTextEditor } from './StickyTextEditor';
import { clampToLimit, applyTextDiff, counterVisible, fitFontSize } from './StickyText';
import { TextEditor, StickyTextEditor as StickyTextEditorGeneralised } from './TextEditor';
import { TextObject } from './TextObject';
import { TextToolbar } from './TextToolbar';
import { registerObjectType, getObjectType, getAllTypes } from './registry';
export { StickyNote, StickyTextEditor, clampToLimit, applyTextDiff, counterVisible, fitFontSize };
export { registerObjectType, getObjectType, getAllTypes, type HandleMode } from './registry';
// Exports for text support
export { TextEditor, TextObject, TextToolbar, StickyTextEditorGeneralised };

import type { ObjectTypeSpec } from './registry';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '@shared/config';
import { TEXT_MIN_WIDTH_WORLD } from '@shared/config';
import type { StickySnapshot } from '@shared/board-model';
import type { TextSnapshot as TextSnapshotType } from '@shared/objects/text';
import type { Point } from '../canvas/camera';
import { objectBounds } from '@shared/board-model';

// Register 'sticky' as a known object type (side effect on import)
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  handles: undefined as 'all' | 'horizontal' | undefined, // default = all
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

// Register 'text' as a known object type (side effect on import)
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal' as 'all' | 'horizontal',
  hitTest: ((obj: any, pt: Point): boolean => {
    const w = obj.width ?? 90;
    const h = obj.height ?? 26;
    return (
      pt.x >= obj.x &&
      pt.y >= obj.y &&
      pt.x <= obj.x + w &&
      pt.y <= obj.y + h
    );
  }) as ObjectTypeSpec['hitTest'],
});
