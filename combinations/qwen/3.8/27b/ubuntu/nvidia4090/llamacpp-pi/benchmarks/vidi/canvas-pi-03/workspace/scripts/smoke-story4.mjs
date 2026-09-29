/**
 * Quick manual smoke test for the story-4 worker (not part of the suite).
 * Boots wrangler dev --local with TEST_HOOKS=1, exercises storage, sync,
 * persistence, corruption and repair over the real protocol.
 */
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import { createEncoder, writeVarUint, writeUint8Array, writeVarUint8Array, toUint8Array } from 'lib0/encoding';
import { createDecoder, readVarUint, readVarUint8Array } from 'lib0/decoding';
import { initDoc, createSticky, snapshot } from '../src/shared/board-model.ts';

const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;

function newBoardId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function http(path, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = request(
      { host: '127.0.0.1', port: PORT, path, method, headers: data ? { 'content-type': 'application/json' } : {} },
      (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function hook(boardId, op, body) {
  return http(`/__test/boards/${boardId}/${op}`, 'POST', body ?? {}).then((r) => {
    try {
      return { status: r.status, json: JSON.parse(r.body) };
    } catch {
      return { status: r.status, text: r.body.slice(0, 200) };
    }
  });
}

class SmokeClient {
  constructor(boardId, doc) {
    this.boardId = boardId;
    this.doc = doc ?? new Y.Doc();
    initDoc(this.doc);
  }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/rooms/${this.boardId}`);
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      const t = setTimeout(() => reject(new Error('connect timeout')), 10000);
      // Behave like a y-websocket provider: push every local doc change.
      this.doc.on('update', (u, origin) => {
        if (origin === 'remote') return;
        if (ws.readyState === WebSocket.OPEN) this.sendUpdate(u);
      });
      ws.onopen = () => {
        clearTimeout(t);
        const enc = createEncoder();
        sync.writeSyncStep1(enc, this.doc);
        ws.send(this.frame(0, toUint8Array(enc)));
        resolve();
      };
      ws.onerror = () => reject(new Error('ws error'));
      ws.onclose = (e) => {
        this.closeCode = e.code;
        this.onclose?.(e.code);
      };
      ws.onmessage = (ev) => this.onMessage(new Uint8Array(ev.data));
    });
  }
  frame(type, payload) {
    const enc = createEncoder();
    writeVarUint(enc, type);
    if (payload) writeUint8Array(enc, payload);
    return new Uint8Array(toUint8Array(enc));
  }
  onMessage(bytes) {
    const dec = createDecoder(bytes);
    const type = readVarUint(dec);
    const payload = bytes.slice(dec.pos);
    if (type === 0) {
      const enc = createEncoder();
      const inner = sync.readSyncMessage(createDecoder(payload), enc, this.doc, 'remote', () => {});
      const reply = toUint8Array(enc);
      if (reply.length > 0 && this.ws.readyState === 1) this.ws.send(this.frame(0, reply));
      if (inner === sync.messageYjsSyncStep2) this.synced = true;
    }
  }
  waitSync(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (this.synced) return resolve();
      const t = setTimeout(() => reject(new Error('sync timeout')), timeoutMs);
      const iv = setInterval(() => {
        if (this.synced) {
          clearTimeout(t);
          clearInterval(iv);
          resolve();
        }
      }, 50);
    });
  }
  apply(u) {
    Y.applyUpdate(this.doc, u);
  }
  sendUpdate(u) {
    const enc = createEncoder();
    sync.writeUpdate(enc, u);
    this.ws.send(this.frame(0, toUint8Array(enc)));
  }
  close() {
    try { this.ws.close(1000); } catch {}
  }
}

async function main() {
  const child = spawn(process.execPath, [
    'node_modules/wrangler/bin/wrangler.js', 'dev', '--port', String(PORT), '--local',
    '--var', 'TEST_HOOKS:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d.toString(); if (err.length > 30000) err = err.slice(-30000); });
  try {
    // wait for ready
    for (let i = 0; i < 240; i++) {
      const r = await http('/').catch(() => null);
      if (r?.status === 200) break;
      await new Promise((r2) => setTimeout(r2, 500));
    }
    console.log('wrangler ready');

    const boardId = newBoardId();

    // 1. storage-info on a fresh board (constructs the room, migrates)
    let r = await hook(boardId, 'storage-info');
    console.log('storage-info fresh:', JSON.stringify(r.json));
    if (!r.json?.tables?.includes('updates')) throw new Error('missing tables');
    if (r.json.storageSchemaVersion !== '1') throw new Error('schema version');

    // 2. two clients sync; A creates a note; B receives; row stored
    const a = new SmokeClient(boardId);
    const b = new SmokeClient(boardId);
    await a.connect(); await b.connect();
    await a.waitSync(); await b.waitSync();
    console.log('both synced');
    const noteId = createSticky(a.doc, { x: 10, y: 20 });
    await new Promise((r) => setTimeout(r, 500));
    r = await hook(boardId, 'storage-info');
    console.log('after note: updates =', r.json.updates, 'bytes =', r.json.updateBytes);
    if (r.json.updates < 1) throw new Error('update not stored');

    // 3. load-fresh returns the note
    r = await hook(boardId, 'load-fresh');
    console.log('load-fresh ok:', r.json.result, 'notes:', r.json.notes.length);
    if (r.json.notes.length !== 1) throw new Error('load-fresh notes');

    // 4. corrupt the update row; load quarantines it
    r = await hook(boardId, 'corrupt-update-row', { seq: 1, mode: 'truncate' });
    console.log('corrupt:', JSON.stringify(r.json));
    r = await hook(boardId, 'load-fresh');
    console.log('load after corrupt:', JSON.stringify(r.json.result), 'quarantined rows:', r.json.notes.length);
    const info = (await hook(boardId, 'storage-info')).json;
    console.log('quarantine table:', JSON.stringify(info.quarantined), 'updates left:', info.updates);

    // 5. repair and confirm load is whole again
    r = await hook(boardId, 'repair');
    console.log('repair:', JSON.stringify(r.json));
    r = await hook(boardId, 'load-fresh');
    if (r.json.notes.length !== 1) throw new Error('repair failed');
    console.log('repaired: notes =', r.json.notes.length);

    // 6. compaction: force-compact, check chunks + through_seq
    r = await hook(boardId, 'store-compact', { force: true });
    console.log('compact:', JSON.stringify(r.json.storage && { c: r.json.storage.chunks, t: r.json.storage.snapshotThroughSeq }));
    const info2 = (await hook(boardId, 'storage-info')).json;
    if (info2.chunks < 1) throw new Error('no chunks after compaction');
    if (Number(info2.snapshotThroughSeq) < 1) throw new Error('no through seq');

    // 7. corrupt snapshot chunk 0 -> load-fresh fails with snapshot-unreadable
    r = await hook(boardId, 'corrupt-snapshot', { idx: 0 });
    console.log('corrupt snapshot:', JSON.stringify(r.json));
    r = await hook(boardId, 'load-fresh');
    console.log('load after snapshot corrupt:', JSON.stringify(r.json.result));
    if (r.json.result?.ok !== false || r.json.result?.reason !== 'snapshot-unreadable') throw new Error('expected snapshot-unreadable');

    // 8. repair; reconstruct the room (simulated wake); still 1 note
    r = await hook(boardId, 'repair');
    r = await hook(boardId, 'simulate-reconstruct');
    console.log('reconstruct:', JSON.stringify(r.json));
    if (r.json.after !== 'ready') throw new Error('reconstruct should be ready');
    r = await hook(boardId, 'load-fresh');
    if (r.json.notes.length !== 1) throw new Error('post-reconstruct notes');

    // 9. live sync after reconstruct: B (still connected) gets a new note
    const id2 = createSticky(a.doc, { x: 50, y: 60 });
    await new Promise((r) => setTimeout(r, 700));
    const bNotes = snapshot(b.doc);
    console.log('B notes after reconstruct + new note:', bNotes.length);
    if (bNotes.length !== 2) throw new Error('B did not receive post-reconstruct update');

    // 10. append failure -> 1011 close on both
    r = await hook(boardId, 'set-failure', { target: 'append' });
    console.log('arm append failure:', JSON.stringify(r.json));
    const c = new SmokeClient(boardId);
    const d = new SmokeClient(boardId);
    const closeCodes = { a: null, b: null, c: null, d: null };
    a.onclose = (code) => (closeCodes.a = code);
    b.onclose = (code) => (closeCodes.b = code);
    c.onclose = (code) => (closeCodes.c = code);
    d.onclose = (code) => (closeCodes.d = code);
    await c.connect(); await d.connect();
    await c.waitSync(); await d.waitSync();
    const id3 = createSticky(c.doc, { x: 1, y: 2 });
    await new Promise((r) => setTimeout(r, 1500));
    console.log('close codes after append failure:', closeCodes);
    if (closeCodes.c !== 1011 || closeCodes.d !== 1011) throw new Error('expected 1011 closes');

    // 11. reconnect: C's unsaved note re-syncs and is stored
    const c2 = new SmokeClient(boardId, c.doc);
    await c2.connect();
    await c2.waitSync();
    await new Promise((r) => setTimeout(r, 700));
    const info3 = (await hook(boardId, 'storage-info')).json;
    r = await hook(boardId, 'load-fresh');
    console.log('after reconnect+resync: notes =', r.json.notes.length, 'stored updates =', info3.updates);
    const allNotes = r.json.notes.map((n) => n.id);
    if (!allNotes.includes(id3)) throw new Error('resynced note missing from storage');

    console.log('\nALL SMOKE CHECKS PASSED');
  } finally {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
    await new Promise((r) => setTimeout(r, 2000));
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
    if (process.exitCode === undefined && err.includes('error')) {
      console.error(err.slice(-3000));
    }
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('SMOKE FAILED:', e);
    process.exit(1);
  },
);
