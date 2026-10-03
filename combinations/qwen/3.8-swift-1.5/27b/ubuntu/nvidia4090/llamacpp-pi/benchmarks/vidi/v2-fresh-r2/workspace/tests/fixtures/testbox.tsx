/**
 * Test-only board object type: `testbox` (story 7 fixtures).
 *
 * A resizable box that is NOT aspect-locked (unlike sticky notes), so
 * component tests can prove the generic transform behaviour before stories
 * 9–12 add real non-locked types. Imported only by tests.
 */

import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import { registerObjectType, boundsHitTest, type ObjectProps } from '../../src/client/objects/registry';
import { insertRawObject } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

function TestBox({ obj, selected, onObjectPointerDown }: ObjectProps): JSX.Element {
  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;
  return (
    <div
      role="group"
      aria-label="Test box"
      data-selected={selected || undefined}
      data-testid="testbox"
      data-note-id={obj.id}
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onObjectPointerDown(e, obj.id);
      }}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        backgroundColor: '#b3d4fc',
        border: '1px solid #6a9bd8',
        pointerEvents: 'auto',
        touchAction: 'none',
      }}
    />
  );
}

let registered = false;
export function registerTestBox(): void {
  if (registered) return;
  registered = true;
  registerObjectType('testbox', {
    Component: TestBox,
    resizable: true,
    aspectLocked: false,
    minSize: 10,
    editableText: false,
    hitTest: boundsHitTest,
  });
}

/** Create a testbox object in the doc and return its id. */
export function createTestBox(
  doc: Y.Doc,
  at: { x: number; y: number },
  size: { width: number; height: number } = { width: 100, height: 60 },
): string {
  return insertRawObject(doc, 'testbox', at, size);
}
