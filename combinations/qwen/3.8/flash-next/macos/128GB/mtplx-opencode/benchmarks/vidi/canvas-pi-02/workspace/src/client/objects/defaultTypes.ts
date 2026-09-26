/**
 * Registers the built-in object types. Import this module once at app start;
 * re-imports are safe because `ensureStickyType` is idempotent.
 */
import {
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  STROKE_MIN_SIZE_WORLD,
} from '../../shared/config';
import { getObjectType, registerObjectType } from './registry';
import { hitTestStroke } from '../../shared/objects/stroke';

export function ensureStickyType(): void {
  if (getObjectType('sticky')) return;
  registerObjectType('sticky', {
    Component: () => null,
    resizable: true,
    aspectLocked: true,
    minSize: STICKY_MIN_SIZE_WORLD,
    editableText: true,
    hitTest(obj, point) {
      const w = obj.width ?? STICKY_SIZE_WORLD;
      const h = obj.height ?? STICKY_SIZE_WORLD;
      return (
        point.x >= obj.x &&
        point.x <= obj.x + w &&
        point.y >= obj.y &&
        point.y <= obj.y + h
      );
    },
  });
}

export function ensureTextType(): void {
  if (getObjectType('text')) return;
  registerObjectType('text', {
    Component: () => null,
    resizable: true,
    aspectLocked: false,
    minSize: TEXT_MIN_WIDTH_WORLD,
    editableText: true,
    handles: 'horizontal',
    hitTest(obj, point) {
      const w = obj.width ?? 80;
      const h = obj.height ?? 26;
      return (
        point.x >= obj.x &&
        point.x <= obj.x + w &&
        point.y >= obj.y &&
        point.y <= obj.y + h
      );
    },
  });
}

export function ensureShapeType(): void {
  if (getObjectType('shape')) return;
  registerObjectType('shape', {
    Component: () => null,
    resizable: true,
    aspectLocked: false,
    minSize: SHAPE_MIN_SIZE_WORLD,
    editableText: true,
    hitTest(obj, point) {
      const w = obj.width ?? 160;
      const h = obj.height ?? 160;
      return (
        point.x >= obj.x &&
        point.x <= obj.x + w &&
        point.y >= obj.y &&
        point.y <= obj.y + h
      );
    },
  });
}

export function ensureConnectorType(): void {
  if (getObjectType('connector')) return;
  registerObjectType('connector', {
    Component: () => null,
    resizable: false,
    aspectLocked: false,
    minSize: 0,
    editableText: false,
    hitTest(_obj, _point, _zoom) {
      // Connector hit test is handled at a higher level via distanceToPolyline.
      return false;
    },
  });
}

export function ensureStrokeType(): void {
  if (getObjectType('stroke')) return;
  registerObjectType('stroke', {
    Component: () => null,
    resizable: true,
    // Proportional, the way the story asks: a drawing stretched sideways is not
    // the same drawing. The ink is rescaled with the box (see `resizeObjects`),
    // and both scales are locked together, so the shape of the line survives.
    aspectLocked: true,
    minSize: STROKE_MIN_SIZE_WORLD,
    editableText: false,
    hitTest(obj, point, zoom) {
      // A stroke is only under the cursor where its ink is. The bounding box is
      // not the answer: a circle drawn in one gesture has a whole empty middle,
      // and clicking in it has to be a click on the board, the same way it is for
      // a ring drawn with the shape tool's outline.
      const stroke = obj as unknown as { points?: number[]; closed?: boolean; thickness?: string };
      // Two numbers is a dot, and a dot is under the cursor: the envelope knows how
      // to measure one, so nothing here may ask for more than a point's worth.
      if (!Array.isArray(stroke.points) || stroke.points.length < 2) return false;
      return hitTestStroke(
        {
          points: stroke.points,
          closed: stroke.closed === true,
          thickness: stroke.thickness ?? 'medium',
          color: 'black',
        } as never,
        { x: point.x - obj.x, y: point.y - obj.y },
        zoom ?? 1,
      );
    },
  });
}

// Ensure they are ready for the app (and tests that import App) at load.
ensureStickyType();
ensureTextType();
ensureShapeType();
ensureConnectorType();
ensureStrokeType();
