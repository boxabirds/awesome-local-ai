/**
 * Story 7 · task 8 — a test-only object type.
 *
 * Registered only in tests, so the selection / transform machinery can be
 * exercised with a *non*-aspect-locked, differently-sized type (TC-24): a plain
 * rectangle that resizes freely in width and height, proving the transform code
 * is generic and not hard-wired to sticky notes.
 *
 * Two registrations are needed for the type to reach the component tree:
 *  - the object-type registry (min size, aspect lock, resizable), and
 *  - `globalThis.__vidi6TestTypes`, which `snapshot()` consults to decide which
 *    `type` values it will serialise (a client that does not know a type must
 *    still load a board that contains it — forward compatibility).
 */
import {
  getObjectType,
  registerObjectType,
} from '../../src/client/objects/registry';

export const TESTBOX_TYPE = 'testbox';

/** The test box is a freely-resizable rectangle with a 10-unit minimum edge. */
export const TESTBOX_MIN_SIZE = 10;

if (typeof globalThis !== 'undefined') {
  const g = globalThis as { __vidi6TestTypes?: readonly string[] };
  const existing = g.__vidi6TestTypes ?? [];
  if (!existing.includes(TESTBOX_TYPE)) {
    g.__vidi6TestTypes = [...existing, TESTBOX_TYPE];
  }
}

/** Register `testbox` unless a previous import already did (module is a singleton). */
export function ensureTestboxRegistered(): void {
  if (getObjectType(TESTBOX_TYPE)) return;
  registerObjectType(TESTBOX_TYPE, {
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest: (obj, p) =>
      p.x >= obj.x && p.x <= obj.x + obj.width && p.y >= obj.y && p.y <= obj.y + obj.height,
  });
}