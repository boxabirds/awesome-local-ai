// Test-only object type (story 7 fixture): a resizable box that does NOT
// lock its aspect ratio (minSize 10). Registered only by tests to prove the
// generic selection/transform machinery before stories 9-12 add real types.

import type { ReactElement } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, registerBoardType } from '../../src/shared/board-model';
import { registerObjectType } from '../../src/client/objects/registry';

const TESTBOX_TYPE = 'testbox';

function Testbox(): ReactElement {
  return <div data-testid="testbox" />;
}

let registered = false;

/** Registers the test-only `testbox` type (client registry + board schema).
 *  Idempotent within a module instance. */
export function registerTestbox(): void {
  if (registered) return;
  registered = true;
  registerBoardType(TESTBOX_TYPE);
  registerObjectType(TESTBOX_TYPE, {
    Component: Testbox,
    resizable: true,
    aspectLocked: false,
    minSize: 10,
    editableText: false,
    hitTest: (obj, p) => {
      const w = obj.width ?? 10;
      const h = obj.height ?? 10;
      return p.x >= obj.x && p.x < obj.x + w && p.y >= obj.y && p.y < obj.y + h;
    },
  });
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const entry of doc.getMap<Y.Map<unknown>>('objects').values()) {
    const z = entry.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

/** Creates a `testbox` at top-left (x, y) with the given size (world units);
 *  returns the new id. */
export function createTestbox(doc: Y.Doc, x: number, y: number, width = 100, height = 50): string {
  registerTestbox();
  const id = crypto.randomUUID();
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', TESTBOX_TYPE);
    entry.set('x', x);
    entry.set('y', y);
    entry.set('width', width);
    entry.set('height', height);
    entry.set('z', maxZ(doc) + 1);
    entry.set('createdAt', 0);
    doc.getMap('objects').set(id, entry);
  }, LOCAL_ORIGIN);
  return id;
}
