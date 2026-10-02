import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  moveObject,
  bringToFront,
  setStickyColor,
  getStickyText,
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { applyTextDiff, clampToLimit } from '../../src/client/objects/StickyText';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  type StickyColor,
} from '../../src/shared/config';
import { RETRO_ITEM, PROSE_1200, SHORT_NOTE } from '../fixtures/texts';

const HALF = STICKY_SIZE_WORLD / 2;

/**
 * Integration level for story 2: the create / move / colour / delete flow
 * exercised through board-model plus the sticky text helpers against a real
 * Y.Doc, asserting the document state a later story would persist and sync.
 * (The design notes there is no request-handling boundary in this story, so
 * these tests stop at the document, not at a server.)
 */
describe('board notes integration: full brainstorm flow on one document', () => {
  let doc: Y.Doc;

  const notes = (): readonly StickySnapshot[] => snapshot(doc);
  const byId = (id: string): StickySnapshot => {
    const note = notes().find((n) => n.id === id);
    if (!note) throw new Error(`note ${id} is gone`);
    return note;
  };
  const write = (id: string, value: string): void => {
    const ytext = getStickyText(doc, id);
    if (!ytext) throw new Error(`no text for ${id}`);
    applyTextDiff(ytext, clampToLimit(value), 'user');
  };

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  it('creates, types, moves, recolours and deletes notes, leaving the document consistent', () => {
    // 1. Capture three ideas by double-clicking empty board space.
    const onboarding = createSticky(doc, { x: 300, y: 200 })!;
    const retro = createSticky(doc, { x: 600, y: 200 })!;
    const duplicate = createSticky(doc, { x: 320, y: 220 })!;

    expect(notes()).toHaveLength(3);
    expect(byId(onboarding)).toMatchObject({
      type: 'sticky',
      color: DEFAULT_STICKY_COLOR,
      text: '',
      x: 300 - HALF,
      y: 200 - HALF,
      z: 1,
    });
    expect(byId(duplicate).z).toBe(3);

    // 2. Type on them.
    write(onboarding, SHORT_NOTE);
    write(retro, RETRO_ITEM);
    write(duplicate, SHORT_NOTE);
    expect(byId(onboarding).text).toBe(SHORT_NOTE);
    expect(byId(retro).text).toBe(RETRO_ITEM);

    // 3. Group the first note next to the retro item by dragging it.
    const before = byId(onboarding);
    expect(moveObject(doc, onboarding, before.x + 120, before.y + 40)).toBe(true);
    expect(byId(onboarding).x).toBe(before.x + 120);
    expect(byId(onboarding).y).toBe(before.y + 40);
    expect(byId(onboarding).text).toBe(SHORT_NOTE);

    // 4. Colour the grouped pair green.
    expect(setStickyColor(doc, onboarding, 'green')).toBe(true);
    expect(setStickyColor(doc, retro, 'green')).toBe(true);
    expect(byId(onboarding).color).toBe('green');
    expect(byId(retro).color).toBe('green');
    expect(byId(duplicate).color).toBe(DEFAULT_STICKY_COLOR);

    // 5. Deleting the duplicate removes it and leaves the rest untouched.
    expect(deleteObject(doc, duplicate)).toBe(true);
    expect(notes()).toHaveLength(2);
    expect(notes().map((n) => n.id).sort()).toEqual([onboarding, retro].sort());
    expect(notes().some((n) => n.id === duplicate)).toBe(false);
    expect(byId(onboarding)).toMatchObject({
      color: 'green',
      text: SHORT_NOTE,
      x: before.x + 120,
      y: before.y + 40,
    });

    // 6. Nothing else in the document was disturbed.
    expect(byId(retro).text).toBe(RETRO_ITEM);
    expect(getStickyText(doc, duplicate)).toBeUndefined();
  });

  it('stacking order after drags is what the renderer sorts by', () => {
    const a = createSticky(doc, { x: 0, y: 0 })!;
    const b = createSticky(doc, { x: 100, y: 0 })!;
    const c = createSticky(doc, { x: 200, y: 0 })!;
    expect(notes().map((n) => n.id)).toEqual([a, b, c]);

    // Drag the bottom note over the others: it ends up on top.
    bringToFront(doc, a);
    moveObject(doc, a, 180, -10);
    expect(notes().map((n) => n.id)).toEqual([b, c, a]);
    expect(byId(a).z).toBeGreaterThan(byId(c).z);

    // Dragging a note that is already on top changes only its position.
    const topZ = byId(a).z;
    expect(bringToFront(doc, a)).toBe(false);
    moveObject(doc, a, 220, 0);
    expect(byId(a).z).toBe(topZ);
    expect(notes().map((n) => n.id)).toEqual([b, c, a]);
  });

  it('a long note keeps the first 1,000 characters and survives later edits', () => {
    const id = createSticky(doc, { x: 400, y: 400 })!;

    write(id, PROSE_1200);
    expect(byId(id).text).toHaveLength(STICKY_TEXT_MAX_CHARS);

    // Editing inside the stored text keeps the stored length legal.
    const ytext = getStickyText(doc, id)!;
    applyTextDiff(ytext, clampToLimit('Start: ' + ytext.toString()), 'user');
    expect(byId(id).text.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(byId(id).text.startsWith('Start: ')).toBe(true);

    // Colour and move are unaffected by the text limit.
    expect(setStickyColor(doc, id, 'violet' as StickyColor)).toBe(true);
    expect(byId(id)).toMatchObject({ color: 'violet', type: 'sticky' });
  });

  it('rejections never change the document', () => {
    const id = createSticky(doc, { x: 10, y: 10 })!;
    const before = JSON.stringify(notes());

    expect(moveObject(doc, 'gone', 5, 5)).toBe(false);
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(deleteObject(doc, 'gone')).toBe(false);
    expect(bringToFront(doc, 'gone')).toBe(false);
    expect(createSticky(doc, { x: Number.NaN, y: 0 })).toBeFalsy();

    expect(JSON.stringify(notes())).toBe(before);
  });

  it('a second document (another client, story 3) can be merged without losing notes', () => {
    const local = createSticky(doc, { x: 0, y: 0 })!;
    write(local, 'Faster ');

    const peer = new Y.Doc();
    initDoc(peer);
    const peerId = createSticky(peer, { x: 500, y: 500 }, 'blue')!;
    const peerText = getStickyText(peer, peerId)!;
    peerText.insert(0, 'Blue note');

    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));

    expect(notes()).toHaveLength(2);
    expect(byId(local).text).toBe('Faster ');
    expect(byId(peerId)).toMatchObject({ color: 'blue', text: 'Blue note' });

    // Minimal-diff typing does not destroy text that arrived from the peer.
    write(local, 'Faster onboarding');
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    expect(getStickyText(peer, local)!.toString()).toBe('Faster onboarding');
    expect(getStickyText(doc, peerId)!.toString()).toBe('Blue note');

    peer.destroy();
    doc.destroy();
  });
});
