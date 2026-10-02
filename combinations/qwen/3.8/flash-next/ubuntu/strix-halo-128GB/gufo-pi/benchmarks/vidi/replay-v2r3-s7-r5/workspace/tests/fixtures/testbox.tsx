/**
 * Test-only registered object type: `testbox`.
 * Resizable, NOT aspect-locked, minSize 10.
 * Imported only by component tests to prove generic behaviour.
 */
import { registerObjectType } from '../../src/client/objects/registry';

registerObjectType('testbox', {
  Component: () => null,
  resizable: true,
  aspectLocked: false,
  minSize: 10,
  editableText: false,
  hitTest: () => true,
});
