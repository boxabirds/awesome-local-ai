/**
 * Registers the sticky note and text object types in the object type registry.
 * Imported by App.tsx (and tests) to populate the registry.
 */
import { registerObjectType } from './registry';
import { objectBounds } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';

// Register sticky note type
registerObjectType('sticky', {
  Component: (() => null) as any, // rendered by App directly; registry is for generic logic
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest(obj, worldPoint) {
    const b = objectBounds(obj);
    return (
      worldPoint.x >= b.x &&
      worldPoint.y >= b.y &&
      worldPoint.x <= b.x + b.width &&
      worldPoint.y <= b.y + b.height
    );
  },
});

// Register text object type (story 9)
registerObjectType('text', {
  Component: (() => null) as any, // rendered by App directly
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest(obj, worldPoint) {
    const b = objectBounds(obj);
    return (
      worldPoint.x >= b.x &&
      worldPoint.y >= b.y &&
      worldPoint.x <= b.x + b.width &&
      worldPoint.y <= b.y + b.height
    );
  },
});
