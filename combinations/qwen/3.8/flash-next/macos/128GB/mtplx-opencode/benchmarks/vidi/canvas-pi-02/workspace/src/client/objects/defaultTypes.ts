/**
 * Registers the built-in object types. Import this module once at app start;
 * re-imports are safe because `ensureStickyType` is idempotent.
 */
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD, SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import { getObjectType, registerObjectType } from './registry';

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

// Ensure they are ready for the app (and tests that import App) at load.
ensureStickyType();
ensureTextType();
ensureShapeType();
ensureConnectorType();
