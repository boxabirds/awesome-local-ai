/**
 * Registers the built-in object types. Import this module once at app start;
 * re-imports are safe because `ensureStickyType` is idempotent.
 */
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../shared/config';
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

// Ensure it is ready for the app (and tests that import App) at load.
ensureStickyType();