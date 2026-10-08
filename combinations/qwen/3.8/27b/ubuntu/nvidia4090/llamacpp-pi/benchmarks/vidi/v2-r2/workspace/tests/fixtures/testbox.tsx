/**
 * Test-only object type (story 7, TC-11..TC-31): a resizable, NOT
 * aspect-locked rectangle registered under the type 'testbox'. It proves the
 * selection / marquee / transform / keyboard machinery is generic (it works
 * for any registered type, not just sticky notes).
 *
 * Importing this module registers the type as a side effect; it is imported
 * only by tests, never by the app.
 */

import * as Y from 'yjs';
import type { JSX } from 'react';
import { registerObjectType, type ObjectProps } from '../../src/client/objects/registry';
import { LOCAL_ORIGIN, maxZ, type ObjectSnapshot } from '../../src/shared/board-model';

/** Default testbox size in world units (not square, to prove no aspect lock). */
export const TESTBOX_WIDTH = 120;
export const TESTBOX_HEIGHT = 80;
/** The testbox minimum size (feeds clampScale; smaller than stickies'). */
export const TESTBOX_MIN_SIZE = 10;

function Testbox({ obj, selected, onPointerDown }: ObjectProps): JSX.Element {
  const box = obj as ObjectSnapshot;
  const width = box.width ?? TESTBOX_WIDTH;
  const height = box.height ?? TESTBOX_HEIGHT;
  return (
    <div
      data-testid="testbox"
      data-object-id={box.id}
      data-selected={selected ? 'true' : 'false'}
      onPointerDown={(event) => {
        // Stop propagation for the same reasons as StickyNote (story 2 / 7):
        // the press belongs to this object, not to the viewport.
        event.stopPropagation();
        onPointerDown(event, box.id);
      }}
      style={{
        position: 'absolute',
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        boxSizing: 'border-box',
        background: '#bfe3ff',
        border: selected ? '2px solid #1a73e8' : '1px solid #7fb2e5',
      }}
    />
  );
}

/**
 * Creates a testbox centred on `at` with the given size. `at` is the
 * centre, mirroring createSticky's convention.
 */
export function createTestbox(
  doc: Y.Doc,
  at: { x: number; y: number },
  size: { width: number; height: number } = {
    width: TESTBOX_WIDTH,
    height: TESTBOX_HEIGHT,
  },
): string {
  const id = crypto.randomUUID();
  doc.transact(
    () => {
      const entry = new Y.Map();
      entry.set('type', 'testbox');
      entry.set('x', at.x - size.width / 2);
      entry.set('y', at.y - size.height / 2);
      entry.set('width', size.width);
      entry.set('height', size.height);
      entry.set('z', maxZ(doc) + 1);
      entry.set('createdAt', Date.now());
      doc.getMap('objects').set(id, entry);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

// Register once at import. (A second registration of 'testbox' throws —
// see the registry unit test for the duplicate path.)
registerObjectType('testbox', {
  Component: Testbox,
  resizable: true,
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE,
  editableText: false,
  hitTest: (obj, p) => {
    const width = obj.width ?? TESTBOX_WIDTH;
    const height = obj.height ?? TESTBOX_HEIGHT;
    return p.x >= obj.x && p.x < obj.x + width && p.y >= obj.y && p.y < obj.y + height;
  },
});
