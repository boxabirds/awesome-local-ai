// sel.objects (story 7, TC-11 to TC-12): the object registry.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { addTestBox } from '../fixtures/testbox';
import { allObjectIds, initDoc, snapshot } from '../../src/shared/board-model';

describe('sel.objects — registry', () => {
  it('TC-11 registering the same type twice throws', () => {
    expect(() =>
      registerObjectType('sticky', {
        Component: () => null,
        resizable: false,
        aspectLocked: false,
        minSize: 1,
        editableText: false,
        hitTest: () => false,
      }),
    ).toThrow(/already registered/);
  });

  it('TC-11b getObjectType returns the spec for a registered type, undefined for others', () => {
    expect(getObjectType('sticky')?.resizable).toBe(true);
    expect(getObjectType('sticky')?.aspectLocked).toBe(true);
    expect(getObjectType('testbox')?.aspectLocked).toBe(false);
    expect(getObjectType('nope')).toBeUndefined();
  });

  it('TC-12 an unregistered type in the doc is skipped by the renderer, not thrown', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // A 'mystery' object straight in the doc (never registered).
    const m = new Y.Map();
    m.set('type', 'mystery');
    m.set('x', 0);
    m.set('y', 0);
    m.set('z', 1);
    m.set('createdAt', Date.now());
    doc.getMap('objects').set('m-1', m);
    addTestBox(doc, 10, 20);

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0]?.type).toBe('testbox');
    expect(allObjectIds(snap)).toEqual([snap[0]!.id]);
    // The renderer path (BoardPage) maps through getObjectType; mystery has
    // no spec, so it is skipped — assert the lookup returns undefined.
    expect(getObjectType('mystery')).toBeUndefined();
  });
});
