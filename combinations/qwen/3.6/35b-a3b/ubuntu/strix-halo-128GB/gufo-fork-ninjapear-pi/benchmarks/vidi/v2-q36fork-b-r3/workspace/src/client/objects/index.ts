import { StickyNote } from './StickyNote';
import { StickyTextEditor } from './StickyTextEditor';
import { clampToLimit, applyTextDiff, counterVisible, fitFontSize } from './StickyText';
import { TextEditor, StickyTextEditor as StickyTextEditorGeneralised } from './TextEditor';
import { TextObject } from './TextObject';
import { TextToolbar } from './TextToolbar';
import { StrokeObject } from './StrokeObject';
import { registerObjectType, getObjectType, getAllTypes } from './registry';
export { StickyNote, StickyTextEditor, clampToLimit, applyTextDiff, counterVisible, fitFontSize };
export { registerObjectType, getObjectType, getAllTypes, type HandleMode } from './registry';
// Exports for text support
export { TextEditor, TextObject, TextToolbar, StickyTextEditorGeneralised };
// Exports for pen/stroke support
export { StrokeObject };

import type { ObjectTypeSpec } from './registry';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '@shared/config';
import { TEXT_MIN_WIDTH_WORLD } from '@shared/config';
import { IMAGE_MIN_SIZE_WORLD } from '@shared/config';
import type { StickySnapshot, ObjectSnap } from '@shared/board-model';
import type { TextSnapshot as TextSnapshotType } from '@shared/objects/text';
import type { ImageSnapshot } from '@shared/objects/image';
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
  hitTest(obj: ObjectSnap, pt: Point): boolean {
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

// Register 'stroke' as a known object type (side effect on import)
import { distanceToPolyline } from '@shared/geometry/polyline';
import { STROKE_HIT_TOLERANCE_PX, PEN_THICKNESS_WORLD, STROKE_MIN_SIZE_WORLD } from '@shared/config';
import type { StrokeSnapshot } from '@shared/board-model';
import { scaledPoints } from '@shared/objects/stroke';

// Register 'image' as a known object type (side effect on import)
import { ImageObject } from './ImageObject';

registerObjectType('image', {
  Component: ImageObject,
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest(obj: ObjectSnap, pt: Point): boolean {
    const b = objectBounds(obj);
    return (
      pt.x >= b.x &&
      pt.y >= b.y &&
      pt.x <= b.x + b.width &&
      pt.y <= b.y + b.height
    );
  },
});

registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest(s: StrokeSnapshot, p: Point, zoom?: number): boolean {
    const pts = scaledPoints(s);
    if (pts.length < 2) return false; // dots can't be hit tested this way
    const z = zoom ?? 1;
    const tolerance = Math.max(
      PEN_THICKNESS_WORLD[s.thickness] / 2,
      STROKE_HIT_TOLERANCE_PX / z,
    );
    return distanceToPolyline(pts, p) <= tolerance;
  },
});
