import type { ObjectTypeSpec } from '../../src/client/objects/registry';
import { registerObjectType } from '../../src/client/objects/registry';

/**
 * A test-only resizable, non-aspect-locked type with minSize 10.
 * Used by component tests to prove generic behaviour independent of sticky notes.
 * Import this in tests only.
 */
export function registerTestbox(): void {
  const spec: ObjectTypeSpec = {
    Component: () => null,
    resizable: true,
    aspectLocked: false,
    minSize: 10,
    editableText: false,
    hitTest: (obj, pt) => {
      const w = obj.width ?? 200;
      const h = obj.height ?? 200;
      return pt.x >= obj.x && pt.y >= obj.y && pt.x < obj.x + w && pt.y < obj.y + h;
    },
  };
  registerObjectType('testbox', spec);
}
