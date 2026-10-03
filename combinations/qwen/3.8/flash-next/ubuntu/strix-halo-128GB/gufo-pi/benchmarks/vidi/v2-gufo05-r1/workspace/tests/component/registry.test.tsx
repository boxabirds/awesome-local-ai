/**
 * The object type registry, as seen through the real `<App>` (`sel.registry`,
 * TC-11, TC-12).
 *
 * `tests/unit/registry.test.ts` covers the table's rules; these cover the promise
 * the table exists for — a type registered outside the app is drawn by the app and
 * takes part in the generic behaviour, and a type nothing has registered is left
 * alone. Both are asserted on the DOM, because "it renders" is the point.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import * as Y from 'yjs';

import { createSticky } from '../../src/shared/board-model';
import {
  createTestBox,
  registerTestBox,
  TESTBOX_HEIGHT_WORLD,
  TESTBOX_SIZE_WORLD,
} from '../fixtures/testbox';
import { advanceFrames, renderStickyApp, type StickyAppHandle } from './stickyHarness';

let board!: StickyAppHandle;

beforeEach(async () => {
  board = await renderStickyApp();
});

/** Elements with a test id, without the throw an unmet query would cause. */
function elements(testId: string): HTMLElement[] {
  return [...document.querySelectorAll(`[data-testid="${testId}"]`)] as HTMLElement[];
}

/** Add objects through the model and let the board draw the result. */
async function add(kind: 'note' | 'box', x: number, y: number): Promise<string> {
  let id = '';
  await act(async () => {
    id = kind === 'note' ? createSticky(board.doc, { x, y }) : createTestBox(board.doc, x, y);
  });
  await advanceFrames();
  return id;
}

/** Put an object of a type nothing has registered into the document by hand. */
async function addUnregistered(id: string): Promise<void> {
  await act(async () => {
    const objects = board.doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 0);
    shape.set('y', 0);
    shape.set('width', 100);
    shape.set('height', 100);
    shape.set('z', 1);
    shape.set('createdAt', Date.now());
    objects.set(id, shape);
  });
  await advanceFrames();
}

describe('TC-11 an object type the app has never seen', () => {
  it('draws it once something registers it, at its own size', async () => {
    registerTestBox();
    const boxId = await add('box', 300, 300);

    const [box] = elements('testbox');
    expect(box).toBeTruthy();
    expect(box?.dataset.objectId).toBe(boxId);
    // Positioned and sized by its own stored rectangle, through the generic
    // renderer: no sticky note code was involved.
    expect(box?.dataset.boxX).toBe(String(300 - TESTBOX_SIZE_WORLD / 2));
    expect(box?.dataset.boxWidth).toBe(String(TESTBOX_SIZE_WORLD));
    expect(box?.dataset.boxHeight).toBe(String(TESTBOX_HEIGHT_WORLD));
    expect(box?.dataset.selected).toBe('false');
    // And it is not drawn as a note.
    expect(elements('sticky-note')).toHaveLength(0);
  });

  it('draws it next to a sticky note, each through its own component', async () => {
    registerTestBox();
    const noteId = await add('note', 700, 300);
    const boxId = await add('box', 300, 300);

    expect(elements('sticky-note').map((note) => note.dataset.noteId)).toEqual([noteId]);
    expect(elements('testbox').map((box) => box.dataset.objectId)).toEqual([boxId]);
  });

  it('leaves a type nothing has registered unrendered', async () => {
    const noteId = await add('note', 0, 0);
    await addUnregistered('shape-1');

    // The note is drawn, the shape is not: the app draws what it has a component
    // for, so an object from a newer client cannot end up on screen — or in a
    // selection, which is built from what is on screen.
    expect(elements('sticky-note').map((note) => note.dataset.noteId)).toEqual([noteId]);
    expect(document.querySelector('[data-object-id="shape-1"]')).toBeNull();
    expect(document.querySelector('[data-note-id="shape-1"]')).toBeNull();
  });
});
