// Story 3 — Worker routing + BoardRoom merge/error integration (tasks 5+6,
// design table TC-04..TC-06, TC-13..TC-18). Runs against the project-wide
// `wrangler dev` on port 8790 (only the restart test boots its own instance).

import { describe, expect, it } from 'vitest';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { decodeMessage } from '../../src/shared/protocol';
import { HTTP_ORIGIN, restartServer, startServer } from './helpers/server';
import {
  awarenessFrame,
  rawClient,
  room,
  syncFrame,
  until,
  yClient,
} from './helpers/ws-client';

function http(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${HTTP_ORIGIN}${path}`, init);
}

describe('worker routing (sync.worker_entry)', () => {
  it('TC-04 negative: malformed board ids get 400 and never reach a Durable Object', async () => {
    // NOTE: '../x'-style paths never reach the Worker literally (the URL
    // parser normalizes them to /x, a static-asset path), so the literal
    // malformed cases are a wrong id, a two-segment path, and the bare
    // namespace route.
    for (const bad of ['/api/rooms/bad!id', '/api/rooms/a/b', '/api/rooms']) {
      const response = await http(bad);
      expect(response.status, bad).toBe(400);
      expect(await response.text()).toBe('Invalid board id');
    }
    // A bad id over a real WebSocket attempt fails the upgrade outright, and
    // afterwards a VALID board still works (nothing was poisoned).
    const failure = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`${HTTP_ORIGIN.replace('http', 'ws')}/api/rooms/bad!id`);
      const timer = setTimeout(() => resolve('hung'), 5000);
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        resolve('error');
      });
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve('open');
      });
    });
    expect(failure).toBe('error');

    const id = room();
    const client = yClient(id);
    expect(await until(() => client.provider.synced, 8000)).toBe(true);
    client.destroy();
  });

  it('TC-05: a valid board id without the Upgrade header answers 426', async () => {
    const id = room(); // 22 chars, structurally valid
    const response = await http(`/api/rooms/${id}`);
    expect(response.status).toBe(426);
    expect(await response.text()).toBe('Upgrade Required');
  });

  it('TC-06: /b/<valid> serves the SPA index (deep links reach the router)', async () => {
    const id = room();
    const response = await http(`/b/${id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const body = await response.text();
    expect(body).toContain('id="root"');
    expect(body).toContain('<script');
  });
});

describe('BoardRoom capacity', () => {
  it('TC-13: MAX+1 (6) concurrent sockets are accepted; the last one syncs and propagates', async () => {
    const id = room();
    const clients = Array.from({ length: 6 }, () => yClient(id));
    expect(await until(() => clients.every((c) => c.provider.synced), 15_000)).toBe(true);

    // Over-capacity is NOT refused (soft limit): the 6th client's create
    // reaches all five others.
    const noteId = createSticky(clients[5].doc, { x: 0, y: 0 });
    expect(
      await until(() => clients.slice(0, 5).every((c) => c.doc.getMap('objects').has(noteId)), 6000),
    ).toBe(true);
    const reference = JSON.stringify(snapshot(clients[5].doc));
    for (const c of clients.slice(0, 5)) {
      expect(JSON.stringify(snapshot(c.doc))).toBe(reference);
    }
    for (const c of clients) c.destroy();
  });

  it('TC-14: a late joiner catches up with 40 notes from two busy clients', async () => {
    const id = room();
    const a = yClient(id);
    const b = yClient(id);
    expect(await until(() => a.provider.synced && b.provider.synced, 12_000)).toBe(true);
    for (let i = 0; i < 20; i++) {
      createSticky(a.doc, { x: i * 300, y: 0 });
      createSticky(b.doc, { x: -i * 300, y: 200 });
    }
    expect(await until(() => a.doc.getMap('objects').size === 40, 8000)).toBe(true);

    const late = yClient(id);
    expect(await until(() => late.provider.synced, 8000)).toBe(true);
    // Synced + caught up: the joiner's snapshot equals the others' exactly.
    expect(await until(() => JSON.stringify(snapshot(late.doc)) === JSON.stringify(snapshot(a.doc)), 5000)).toBe(true);
    a.destroy();
    b.destroy();
    late.destroy();
  });
});

describe('BoardRoom error handling', () => {
  it('TC-15 negative: malformed traffic closes ONLY the offender; the room and the bystander stay healthy', async () => {
    // Four flavours of "malformed": text frame, truncated length prefix,
    // unknown message type 9, and an undecodable sync update.
    const payloads: Array<{ label: string; send: (ws: WebSocket) => void }> = [
      { label: 'text frame', send: (ws) => ws.send('this is not sync') },
      { label: 'truncated bytes', send: (ws) => ws.send(Uint8Array.from([0, 2, 50, 1, 2, 3])) },
      { label: 'unknown type 9', send: (ws) => ws.send(Uint8Array.from([9, 1, 1, 7])) },
      { label: 'corrupt sync update', send: (ws) => ws.send(syncFrame(2, Uint8Array.from([0xff, 0xfe, 0xfd, 0x00]))) },
    ];

    for (const { label, send } of payloads) {
      const id = room();
      const bystander = yClient(id);
      expect(await until(() => bystander.provider.synced, 8000)).toBe(true);
      const noteId = createSticky(bystander.doc, { x: 0, y: 0 }); // give the room real content
      expect(await until(() => bystander.doc.getMap('objects').size === 1, 3000)).toBe(true);

      const offender = await rawClient(id);
      send(offender.ws);
      const code = await Promise.race([
        offender.closed,
        new Promise<number>((resolve) => setTimeout(() => resolve(-1), 6000)),
      ]);
      expect(code, `close code for ${label}`).toBe(1003); // CLOSE_UNSUPPORTED_DATA

      // The bystander socket is untouched and the room still relays: a fresh
      // client joins and converges on the untouched document.
      const joiner = yClient(id);
      expect(await until(() => joiner.provider.synced, 8000)).toBe(true);
      expect(await until(() => joiner.doc.getMap('objects').has(noteId), 5000)).toBe(true);
      expect(joiner.doc.getMap('objects').size).toBe(1); // doc unchanged by the malformed frame
      expect(bystander.provider.wsconnected, 'bystander socket untouched').toBe(true);
      expect(bystander.provider.synced).toBe(true);
      bystander.destroy();
      joiner.destroy();
      offender.close();
    }
  });

  it('TC-16: awareness bytes are relayed verbatim to every socket, including the sender', async () => {
    const id = room();
    const sender = await rawClient(id);
    const watcher = await rawClient(id);
    await new Promise((r) => setTimeout(r, 500)); // let both sync steps settle

    // Two crafted awareness-channel frames (the room relays them verbatim;
    // it never parses awareness content in this story).
    const frame1 = awarenessFrame(Uint8Array.from([1, 42, 1, 3, 123, 34, 125]));
    const frame2 = awarenessFrame(Uint8Array.from([1, 42, 2, 1, 0]));
    sender.ws.send(frame1);
    sender.ws.send(frame2);
    await new Promise((r) => setTimeout(r, 600));

    // The watcher received BOTH frames byte-for-byte…
    expect(watcher.frames.some((f) => f.length === frame1.length && f.every((b, i) => b === frame1[i]))).toBe(true);
    expect(watcher.frames.some((f) => f.length === frame2.length && f.every((b, i) => b === frame2[i]))).toBe(true);
    // …and so did the SENDER (echo back, by design for idle keepalive).
    const echo1 = sender.frames.find((f) => f.length === frame1.length && f.every((b, i) => b === frame1[i]));
    expect(echo1).toBeDefined();
    expect(decodeMessage(new Uint8Array(echo1!.buffer, echo1!.byteOffset, echo1!.byteLength)).kind).toBe('awareness');
    sender.close();
    watcher.close();
  });
});

describe('BoardRoom merge semantics', () => {
  it('TC-11: delete during a concurrent text insert — delete wins, no resurrection, no exception', async () => {
    const id = room();
    const a = yClient(id);
    const b = yClient(id);
    expect(await until(() => a.provider.synced && b.provider.synced, 12_000)).toBe(true);

    const noteId = createSticky(a.doc, { x: 0, y: 0 });
    expect(await until(() => b.doc.getMap('objects').has(noteId), 5000)).toBe(true);

    // Concurrently: B inserts into the note's text while A deletes the note.
    // No ordering between them — the CRDT must settle identically on both.
    let threw = false;
    try {
      const textB = getStickyText(b.doc, noteId)!;
      textB.insert(0, 'while-you-were-deleting');
      deleteObject(a.doc, noteId);
      // Apply both directions fully.
      await new Promise((r) => setTimeout(r, 800));
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    // The note is gone on both sides and stays gone (no resurrection).
    expect(a.doc.getMap('objects').has(noteId)).toBe(false);
    expect(b.doc.getMap('objects').has(noteId)).toBe(false);
    // A further local op proves the docs still work and stay convergent.
    const lateNote = createSticky(b.doc, { x: 100, y: 0 });
    expect(await until(() => a.doc.getMap('objects').has(lateNote), 5000)).toBe(true);
    a.destroy();
    b.destroy();
  });

  it('TC-12: 5 clients × 200 seeded random ops converge to one board (seed 1234)', async () => {
    const SEED = 1234; // change only when debugging: log is deterministic
    let rngState = SEED;
    const rand = () => {
      // mulberry32
      rngState |= 0;
      rngState = (rngState + 0x6d2b79f5) | 0;
      let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    console.log(`TC-12 seed=${SEED}`);

    const id = room();
    const clients = Array.from({ length: 5 }, () => yClient(id));
    expect(await until(() => clients.every((c) => c.provider.synced), 15_000)).toBe(true);

    // 200 operations spread across all five clients, one at a time in a
    // round-robin so every client applies remote ops between its own.
    for (let op = 0; op < 200; op++) {
      const client = clients[op % 5];
      const notes = [...client.doc.getMap('objects').keys()];
      const pick = () => notes[Math.floor(rand() * notes.length)];
      switch (Math.floor(rand() * 4)) {
        case 0:
          createSticky(client.doc, { x: Math.floor(rand() * 2000 - 1000), y: Math.floor(rand() * 2000 - 1000) });
          break;
        case 1:
          if (notes.length > 0) moveObject(client.doc, pick(), rand() * 2000 - 1000, rand() * 2000 - 1000);
          break;
        case 2:
          if (notes.length > 0) setStickyColor(client.doc, pick(), ['orange', 'green', 'blue', 'pink', 'violet'][Math.floor(rand() * 5)]);
          break;
        default:
          if (notes.length > 2) deleteObject(client.doc, pick());
          break;
      }
      await new Promise((r) => setTimeout(r, 5)); // let traffic flow
    }

    expect(
      await until(
        () => clients.slice(1).every((c) => JSON.stringify(snapshot(c.doc)) === JSON.stringify(snapshot(clients[0].doc))),
        20_000,
      ),
    ).toBe(true);
    // And every board kept real content (deletions never wiped everything).
    expect(clients[0].doc.getMap('objects').size).toBeGreaterThan(2);
    for (const c of clients) c.destroy();
  });
});

describe('restart and rebuild (TC-18, file-local server)', () => {
  it('TC-18: after a restart the room rebuilds from the first reconnecting client', async () => {
    const server = await startServer(8792); // dedicated instance, restartable
    try {
      const id = room();
      const a = yClient(id, undefined, { origin: server.wsOrigin });
      const b = yClient(id, undefined, { origin: server.wsOrigin });
      expect(await until(() => a.provider.synced && b.provider.synced, 15_000)).toBe(true);
      for (let i = 0; i < 3; i++) createSticky(a.doc, { x: i * 300, y: 0 });
      expect(await until(() => b.doc.getMap('objects').size === 3, 5000)).toBe(true);
      const before = JSON.stringify(snapshot(b.doc));

      // Kill + respawn: every socket drops, the room doc is gone.
      const restarted = await restartServer(server);

      // After the restart, the room answers each new socket with its (empty)
      // SyncStep1; the reconnecting old client must answer with SyncStep2 and
      // repopulate. A fresh client then has to converge on the rebuilt state.
      const late = yClient(id, undefined, { origin: restarted.wsOrigin });
      expect(await until(() => late.provider.synced, 20_000)).toBe(true);
      // B (or A) reconnects and the two old docs converge with the joiner.
      const converged = await until(
        () =>
          JSON.stringify(snapshot(a.doc)) === before &&
          JSON.stringify(snapshot(late.doc)) === before,
        30_000,
      );
      expect(converged).toBe(true);
      a.destroy();
      b.destroy();
      late.destroy();
    } finally {
      await server.stop();
    }
  }, 90_000);
});