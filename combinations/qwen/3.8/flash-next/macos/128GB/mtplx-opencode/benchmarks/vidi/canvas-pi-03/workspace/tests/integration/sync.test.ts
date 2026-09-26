// Story 3 — sync protocol integration tests (TC-04..TC-07).
// Every client here is a REAL Y.Doc driven by the REAL y-websocket provider
// over a REAL WebSocket into the workerd BoardRoom Durable Object.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { decodeMessage } from '../../src/shared/protocol';
import { isUpdateFrame, room, textOf, until, yClient } from './helpers/ws-client';

function sameState(a: Y.Doc, b: Y.Doc): boolean {
  const sa = Y.encodeStateVector(a);
  const sb = Y.encodeStateVector(b);
  if (sa.length !== sb.length) return false;
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

describe('sync protocol over WebSockets', () => {
  it('TC-04: a new client receives a full sync and updates relay with update-type frames', async () => {
    const id = room();
    const a = yClient(id);
    const b = yClient(id);
    expect(await until(() => a.provider.synced && b.provider.synced)).toBe(true);

    const noteId = createSticky(a.doc, { x: 0, y: 0 });

    // The update reaches b and arrives as a sync UPDATE frame (channel 0).
    expect(await until(() => b.doc.getMap('objects').has(noteId), 5000)).toBe(true);
    const inbound = b.frames.filter((f) => f.dir === 'in');
    expect(inbound.some((f) => isUpdateFrame(f.bytes))).toBe(true);
    // Every frame from the server decodes as a valid protocol message.
    for (const f of inbound) expect(decodeMessage(f.bytes).kind).not.toBe('invalid');
    expect(JSON.stringify(snapshot(a.doc))).toBe(JSON.stringify(snapshot(b.doc)));
    a.destroy();
    b.destroy();
  });

  it('TC-05: concurrent creates merge into one board; other boards are not affected', async () => {
    const idA = room();
    const idB = room();
    const a1 = yClient(idA);
    const a2 = yClient(idA);
    const b1 = yClient(idB);
    const b2 = yClient(idB);
    expect(await until(() => [a1, a2, b1, b2].every((c) => c.provider.synced))).toBe(true);

    // Both sides create on board A before either has received the other's
    // change (back-to-back, sub-millisecond apart).
    const from1 = createSticky(a1.doc, { x: 100, y: 100 });
    const from2 = createSticky(a2.doc, { x: 300, y: 100 });
    expect(
      await until(
        () => a1.doc.getMap('objects').size === 2 && a2.doc.getMap('objects').size === 2,
        5000,
      ),
    ).toBe(true);
    expect(JSON.stringify(snapshot(a1.doc))).toBe(JSON.stringify(snapshot(a2.doc)));

    // Board isolation: b's create converges inside B and never crosses into A.
    const fromB = createSticky(b1.doc, { x: 0, y: 0 });
    expect(await until(() => b2.doc.getMap('objects').has(fromB), 5000)).toBe(true);
    expect(b2.doc.getMap('objects').has(from1)).toBe(false);
    expect(b2.doc.getMap('objects').has(from2)).toBe(false);
    expect(a2.doc.getMap('objects').has(fromB)).toBe(false);
    [a1, a2, b1, b2].forEach((c) => c.destroy());
  });

  it('TC-06: concurrent edits to the same text region converge to one value', async () => {
    const id = room();
    const a = yClient(id);
    const b = yClient(id);
    expect(await until(() => a.provider.synced && b.provider.synced)).toBe(true);

    const noteId = createSticky(a.doc, { x: 0, y: 0 });
    expect(await until(() => b.doc.getMap('objects').has(noteId), 5000)).toBe(true);

    // Both ends edit the same region of the same shared text.
    const textA = a.doc.getMap<Y.Map<unknown>>('objects').get(noteId)!.get('text') as Y.Text;
    const textB = b.doc.getMap<Y.Map<unknown>>('objects').get(noteId)!.get('text') as Y.Text;
    textA.insert(0, 'hello-from-A ');
    textB.insert(0, 'hi-from-B ');

    expect(await until(() => textOf(a.doc, noteId) === textOf(b.doc, noteId), 5000)).toBe(true);
    const finalText = textOf(a.doc, noteId)!;
    // Character-safe: both insertions survive in the converged value.
    expect(finalText).toContain('hello-from-A');
    expect(finalText).toContain('hi-from-B');
    expect(sameState(a.doc, b.doc)).toBe(true);
    a.destroy();
    b.destroy();
  });

  it('TC-07: 25 messages in ~2s (with an idle gap) all arrive; docs converge within 3s of the last', async () => {
    const id = room();
    const a = yClient(id);
    const b = yClient(id);
    expect(await until(() => a.provider.synced && b.provider.synced)).toBe(true);

    const t0 = Date.now();
    for (let i = 0; i < 24; i++) {
      createSticky(a.doc, { x: (i % 5) * 160, y: Math.floor(i / 5) * 160 });
      await new Promise((r) => setTimeout(r, 80)); // ~24 messages in ~2s
    }
    await new Promise((r) => setTimeout(r, 600)); // idle gap: keepalive takes over
    createSticky(b.doc, { x: 800, y: 0 }); // one more message from the other end

    // The last message arrives within 3s and both docs converge within 3s.
    expect(await until(() => b.doc.getMap('objects').size === 25, 3000)).toBe(true);
    expect(await until(() => sameState(a.doc, b.doc), 3000)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(25_000);
    a.destroy();
    b.destroy();
  });
});