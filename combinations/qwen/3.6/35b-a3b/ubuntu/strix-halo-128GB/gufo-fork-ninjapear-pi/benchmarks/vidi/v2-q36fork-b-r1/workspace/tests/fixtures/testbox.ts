/**
 * Test-only object type: 'testbox' — resizable, not aspect-locked, minSize 10.
 * Used by component tests to prove generic behaviour beyond sticky notes.
 */
import { registerObjectType } from '@/client/objects/registry';
import type { ObjectSnapshot } from '@/client/objects/registry';

const TESTBOX_MIN_SIZE = 10;
const TESTBOX_SIZE = 100;

// Register testbox type on import
registerObjectType('testbox', {
  Component: (_props: any) => null, // Placeholder — tests manipulate state directly
  resizable: true,
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE,
  editableText: false,
  hitTest: (obj: ObjectSnapshot, wp: { x: number; y: number }) => {
    const w = obj.width ?? TESTBOX_SIZE;
    const h = obj.height ?? TESTBOX_SIZE;
    return (
      wp.x >= obj.x &&
      wp.y >= obj.y &&
      wp.x <= obj.x + w &&
      wp.y <= obj.y + h
    );
  },
});
