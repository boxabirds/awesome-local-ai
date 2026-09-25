/**
 * Test-only object type for component tests (story 7).
 * Proves generic behaviour before stories 9–12 add real types.
 */
import { registerObjectType, __resetRegistry, getObjectType } from '../../src/client/objects/registry';
import type { ObjectTypeSpec } from '../../src/client/objects/registry';

/** Register the testbox type if not already registered. */
export function ensureTestbox(): void {
  if (getObjectType('testbox')) return;
  const testboxSpec: ObjectTypeSpec = {
    Component: () => null,
    resizable: true,
    aspectLocked: false,
    minSize: 10,
    editableText: false,
    hitTest(obj, point) {
      const w = obj.width ?? 100;
      const h = obj.height ?? 100;
      return (
        point.x >= obj.x &&
        point.x <= obj.x + w &&
        point.y >= obj.y &&
        point.y <= obj.y + h
      );
    },
  };
  registerObjectType('testbox', testboxSpec);
}

/** Remove all registrations (for test cleanup). */
export { __resetRegistry };
