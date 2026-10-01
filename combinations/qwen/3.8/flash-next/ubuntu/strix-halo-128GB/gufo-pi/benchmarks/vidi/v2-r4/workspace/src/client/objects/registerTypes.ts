/**
 * Registers the sticky note object type in the object type registry.
 * Imported by App.tsx (and tests) to populate the registry.
 */
import { registerObjectType } from './registry';
import { objectBounds } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';

// We register a placeholder Component here; the actual StickyNote component
// is rendered directly from App.tsx. The registry entry is used by the
// generic transform/selection machinery to query per-type behaviour.
registerObjectType('sticky', {
  Component: (() => null) as any, // rendered by App directly; registry is for generic logic
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
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
