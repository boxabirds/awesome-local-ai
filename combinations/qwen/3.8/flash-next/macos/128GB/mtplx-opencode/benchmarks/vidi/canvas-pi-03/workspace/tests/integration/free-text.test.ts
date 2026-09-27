// Story 9 — free-text blocks across real clients (contract `text.model`).
//
// Every client here is a real Y.Doc driven by the real y-websocket provider
// over a real WebSocket into the workerd BoardRoom, exactly like the sync
// suite. Text blocks are created and edited through the SAME framework-free
// operations the browser uses, so what converges here is what ships.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createText,
  deleteIfEmpty,
  getTextObject,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { LOCAL_ORIGIN, deleteObjects, moveObjects, objectSnapshots } from '../../src/shared/board-model';
import { createUndo } from '../../src/client/board/undo';
import { createRoom, yClient, until, type YClient } from './helpers/ws-client';

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function textOf(doc: Y.Doc, id: string): Y.Text {
  const text = objectsOf(doc).get(id)?.get('text') as Y.Text | undefined;
  if (text === undefined) throw new Error(`no text block ${id}`);
  return text;
}

/** Type into a block the way the editor does: characters plus the measured
 * box, in one LOCAL_ORIGIN transaction (TC-20). */
function type(doc: Y.Doc, id: string, chars: string, box?: { width: number; height: number }): void {
  doc.transact(() => {
    const text = textOf(doc, id);
    text.insert(text.length, chars);
    if (box !== undefined) setTextBox(doc, id, box);
  }, LOCAL_ORIGIN);
}

/** Which objects one transaction touched. `Transaction.changed` keys every
 * type that changed; a text edit shows up as its Y.Text, a box write as the
 * object's own Y.Map, a create/delete as a key on the board's objects map. */
function touchedObjects(doc: Y.Doc, tr: Y.Transaction): string[] {
  const objects = objectsOf(doc);
  const ids = new Set<string>();
  (tr.changed as Map<unknown, Set<string>>).forEach((keys, type) => {
    if (type === objects) {
      for (const key of keys) ids.add(key);
      return;
    }
    objects.forEach((record, id) => {
      if ((record as unknown) === type || record.get('text') === type) ids.add(id);
    });
  });
  return [...ids];
}

/** Record every transaction (origin + objects touched) until stopped. */
function traceTransactions(doc: Y.Doc): {
  rows: Array<{ origin: unknown; objects: string[] }>;
  stop(): void;
} {
  const rows: Array<{ origin: unknown; objects: string[] }> = [];
  const listener = (tr: Y.Transaction) => {
    rows.push({ origin: tr.origin, objects: touchedObjects(doc, tr) });
  };
  doc.on('afterTransaction', listener);
  return { rows, stop: () => doc.off('afterTransaction', listener) };
}

/** Local (this-tab) transactions only — what the undo stacks would see. */
function localRows(rows: ReadonlyArray<{ origin: unknown; objects: string[] }>) {
  return rows.filter((row) => row.origin === LOCAL_ORIGIN);
}

/** True when every client holds byte-identical board state. Compared through
 * `objectSnapshots`, which sorts by z then id, so replica key order — which
 * Y.Map does NOT normalise — cannot fake a mismatch or hide one. */
function sameBoard(clients: readonly YClient[]): boolean {
  const reference = JSON.stringify(objectSnapshots(clients[0]!.doc));
  return clients.every((c) => JSON.stringify(objectSnapshots(c.doc)) === reference);
}

describe('free-text blocks over WebSockets', () => {
  it('TC-19: text blocks converge between two real clients', async () => {
    const id = await createRoom();
    const a = yClient(id);
    const b = yClient(id);
    expect(await until(() => a.provider.synced && b.provider.synced)).toBe(true);

    // A creates two blocks and edits them; B creates a third, blind to A.
    const first = createText(a.doc, { x: 100, y: 100 }, 'client-a');
    const second = createText(a.doc, { x: 400, y: 100 }, 'client-a');
    if (first === null || second === null) throw new Error('createText failed');
    type(a.doc, first, 'Hello');
    setTextSize(a.doc, second, 'L');
    setTextWidthFixed(a.doc, second, 260);

    const third = createText(b.doc, { x: 700, y: 100 }, 'client-b');
    expect(third).not.toBeNull();

    expect(await until(() => objectsOf(a.doc).size === 3 && objectsOf(b.doc).size === 3, 10_000)).toBe(true);
    expect(await until(() => sameBoard([a, b]), 10_000)).toBe(true);

    // The footprint, the size preset and the width mode travel with the block:
    // B reads exactly what A stored, without measuring anything.
    expect(getTextObject(b.doc, second)).toMatchObject({ size: 'L', widthMode: 'fixed', width: 260 });
    expect(getTextObject(b.doc, first)?.text).toBe('Hello');

    // Deleting on one side deletes on the other: a delete is a map removal, so
    // it converges, and neither side keeps a ghost.
    b.doc.transact(() => {
      deleteObjects(b.doc, [first]);
    }, LOCAL_ORIGIN);
    expect(await until(() => !objectsOf(a.doc).has(first) && !objectsOf(b.doc).has(first), 10_000)).toBe(true);
    expect(sameBoard([a, b])).toBe(true);

    a.destroy();
    b.destroy();
  });

  it('TC-20: a text edit is one single-object transaction, and so is deleting an empty block', async () => {
    const id = await createRoom();
    const a = yClient(id);
    const b = yClient(id);
    expect(await until(() => a.provider.synced && b.provider.synced)).toBe(true);

    const block = createText(a.doc, { x: 0, y: 0 }, 'client-a')!;
    expect(await until(() => objectsOf(b.doc).has(block), 10_000)).toBe(true);

    // Everything one typing step writes — characters plus the measured box —
    // leaves as ONE transaction, and it touches exactly one object.
    const typing = traceTransactions(a.doc);
    type(a.doc, block, 'hello', { width: 240, height: 120 });
    typing.stop();
    const typingSteps = localRows(typing.rows);
    expect(typingSteps).toHaveLength(1);
    expect(typingSteps[0]!.objects).toEqual([block]);
    expect(getTextObject(a.doc, block)).toMatchObject({ text: 'hello', width: 240, height: 120 });

    // A block that still holds text survives the cleanup check, and the check
    // writes nothing at all when it declines.
    const declining = traceTransactions(a.doc);
    expect(deleteIfEmpty(a.doc, block)).toBe(false);
    declining.stop();
    expect(localRows(declining.rows)).toHaveLength(0);

    // An abandoned block is removed in one transaction that names one object.
    const empty = createText(a.doc, { x: 500, y: 0 }, 'client-a')!;
    expect(await until(() => objectsOf(b.doc).size === 2, 10_000)).toBe(true);
    const removal = traceTransactions(a.doc);
    expect(deleteIfEmpty(a.doc, empty)).toBe(true);
    removal.stop();
    const removals = localRows(removal.rows);
    expect(removals).toHaveLength(1);
    expect(removals[0]!.objects).toEqual([empty]);
    expect(await until(() => !objectsOf(b.doc).has(empty), 10_000)).toBe(true);
    expect(objectSnapshots(b.doc).find((o) => o.id === empty)).toBeUndefined();

    a.destroy();
    b.destroy();
  });

  it('TC-21: undo is per person — one client undoing never reverts the other', async () => {
    const id = await createRoom();
    const a = yClient(id);
    const b = yClient(id);
    expect(await until(() => a.provider.synced && b.provider.synced)).toBe(true);

    const mine = createText(a.doc, { x: 0, y: 0 }, 'client-a')!;
    const theirs = createText(b.doc, { x: 400, y: 0 }, 'client-b')!;
    expect(await until(() => objectsOf(a.doc).size === 2 && objectsOf(b.doc).size === 2, 10_000)).toBe(true);
    expect(await until(() => sameBoard([a, b]), 10_000)).toBe(true);

    // One controller per tab, filtering on LOCAL_ORIGIN. A synced peer edit
    // arrives with the provider as its origin, so it can never enter this
    // tab's undo stack — that is what makes "undo only your own work" true.
    const undoA = createUndo(a.doc);
    const undoB = createUndo(b.doc);

    type(a.doc, mine, 'mine');
    expect(await until(() => textOf(b.doc, mine).toString() === 'mine', 10_000)).toBe(true);
    // B received A's typing and must NOT have gained an undo step for it.
    expect(undoB.canUndo()).toBe(false);

    type(b.doc, theirs, 'theirs');
    expect(await until(() => textOf(a.doc, theirs).toString() === 'theirs', 10_000)).toBe(true);
    expect(undoA.canUndo()).toBe(true);
    expect(undoB.canUndo()).toBe(true);

    // Undo in A reverts A's typing — and leaves B's block exactly as B left it.
    expect(undoA.undo()).toBe(true);
    expect(textOf(a.doc, mine).toString()).toBe('');
    expect(textOf(a.doc, theirs).toString()).toBe('theirs');

    // The mirror holds too: B's single undo step is B's own typing. At the
    // moment of undo, A's text is still sitting in B's copy — undo is a local
    // change, and reverting it has to travel before the boards agree again.
    expect(undoB.undo()).toBe(true);
    expect(textOf(b.doc, theirs).toString()).toBe('');
    expect(textOf(b.doc, mine).toString()).toBe('mine');
    expect(
      await until(
        () => textOf(b.doc, mine).toString() === '' && textOf(a.doc, theirs).toString() === '',
        10_000,
      ),
    ).toBe(true);
    expect(await until(() => sameBoard([a, b]), 10_000)).toBe(true);

    undoA.destroy();
    undoB.destroy();
    a.destroy();
    b.destroy();
  });

  it('TC-22: a remote delete of the block being edited leaves no ghost editor', async () => {
    const id = await createRoom();
    const a = yClient(id);
    const b = yClient(id);
    expect(await until(() => a.provider.synced && b.provider.synced)).toBe(true);

    const block = createText(a.doc, { x: 0, y: 0 }, 'client-a')!;
    type(a.doc, block, 'being edited');
    expect(await until(() => objectsOf(b.doc).has(block), 10_000)).toBe(true);

    // B deletes the block out from under A.
    b.doc.transact(() => {
      deleteObjects(b.doc, [block]);
    }, LOCAL_ORIGIN);
    expect(await until(() => !objectsOf(a.doc).has(block), 10_000)).toBe(true);

    // A late local write from A — the last keystroke of a stroke that was
    // still in flight — finds no object, writes nothing, and cannot
    // resurrect it on either side.
    a.doc.transact(() => {
      const record = objectsOf(a.doc).get(block);
      if (record === undefined) return;
      (record.get('text') as Y.Text).insert(0, 'ghost');
    }, LOCAL_ORIGIN);
    expect(objectsOf(a.doc).has(block)).toBe(false);
    expect(objectsOf(b.doc).has(block)).toBe(false);
    expect(sameBoard([a, b])).toBe(true);

    a.destroy();
    b.destroy();
  });

  it('TC-26: a whole drag of a text block is one transaction, syncs, and undoes in one step', async () => {
    const id = await createRoom();
    const a = yClient(id);
    const b = yClient(id);
    expect(await until(() => a.provider.synced && b.provider.synced)).toBe(true);

    const block = createText(a.doc, { x: 0, y: 0 }, 'client-a')!;
    type(a.doc, block, 'moved block');
    expect(await until(() => sameBoard([a, b]), 10_000)).toBe(true);

    // The controller exists BEFORE the gesture, and the gesture's commit is a
    // single transaction over a single object.
    const undo = createUndo(a.doc);
    const trace = traceTransactions(a.doc);
    // The pointer gesture commits once, on release: one transaction, one object.
    a.doc.transact(() => {
      moveObjects(a.doc, [block], 320, 210);
    }, LOCAL_ORIGIN);
    trace.stop();
    const commits = localRows(trace.rows);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.objects).toEqual([block]);

    expect(await until(() => sameBoard([a, b]), 10_000)).toBe(true);
    const moved = objectsOf(b.doc).get(block)!;
    expect([moved.get('x'), moved.get('y')]).toEqual([320, 210]);

    // One undo step takes the whole gesture back, on both sides.
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    const back = objectsOf(a.doc).get(block)!;
    expect([back.get('x'), back.get('y')]).toEqual([0, 0]);
    expect(await until(() => sameBoard([a, b]), 10_000)).toBe(true);

    undo.destroy();
    a.destroy();
    b.destroy();
  });

  it('TC-30: copying a block into another board keeps text, size and width mode', async () => {
    const [sourceId, targetId] = [await createRoom(), await createRoom()];
    const source = yClient(sourceId);
    const target = yClient(targetId);
    expect(await until(() => source.provider.synced && target.provider.synced)).toBe(true);

    const block = createText(source.doc, { x: 0, y: 0 }, 'author')!;
    source.doc.transact(() => {
      textOf(source.doc, block).insert(0, 'wrap me');
      const record = objectsOf(source.doc).get(block)!;
      record.set('size', 'XL');
      record.set('widthMode', 'fixed');
      record.set('width', 320);
      record.set('height', 160);
    }, LOCAL_ORIGIN);

    // The copy is an ordinary update, applied to the second board.
    const update = Y.encodeStateAsUpdate(source.doc);
    target.doc.transact(() => {
      Y.applyUpdate(target.doc, update);
    });
    expect(getTextObject(target.doc, block)).toEqual({
      text: 'wrap me',
      size: 'XL',
      widthMode: 'fixed',
      width: 320,
      height: 160,
    });
    // Two boards, two object sets: the copy did not merge them.
    expect(objectsOf(source.doc).size).toBe(1);
    expect(objectsOf(target.doc).size).toBe(1);

    source.destroy();
    target.destroy();
  });

  it('TC-33: a block written before a disconnect is handed to a client that joins after it', async () => {
    const id = await createRoom();
    const writer = yClient(id);
    expect(await until(() => writer.provider.synced)).toBe(true);

    const block = createText(writer.doc, { x: 0, y: 0 }, 'writer')!;
    type(writer.doc, block, 'kept');
    expect(await until(() => writer.frames.some((f) => f.dir === 'out'), 5_000)).toBe(true);
    writer.destroy();

    // A newcomer that never saw the write is handed the block by the sync
    // reply, footprint and text included.
    const late = yClient(id);
    expect(await until(() => late.provider.synced, 10_000)).toBe(true);
    expect(await until(() => objectsOf(late.doc).has(block), 10_000)).toBe(true);
    expect(getTextObject(late.doc, block)?.text).toBe('kept');
    late.destroy();
  });

  it('TC-34: ten concurrent creators converge on the same object set', async () => {
    const id = await createRoom();
    const clients = Array.from({ length: 10 }, () => yClient(id));
    expect(await until(() => clients.every((c) => c.provider.synced), 20_000)).toBe(true);

    // Everyone creates before any of them has seen anyone else.
    clients.forEach((client, index) => {
      createText(client.doc, { x: index * 100, y: 0 }, `client-${index}`);
    });

    expect(await until(() => clients.every((c) => objectsOf(c.doc).size === 10), 20_000)).toBe(true);
    expect(await until(() => sameBoard(clients), 20_000)).toBe(true);

    // Nothing was lost or duplicated: ten distinct ids, on every client.
    for (const client of clients) {
      const ids = objectSnapshots(client.doc).map((o) => o.id);
      expect(new Set(ids).size).toBe(10);
    }
    for (const client of clients) client.destroy();
  });
});
