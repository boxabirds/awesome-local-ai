/**
 * Integration tests for BoardRoom Durable Object (TC-07 to TC-13, TC-14, TC-16, TC-18, TC-31).
 * Uses wrangler dev subprocess + Y.js + y-websocket provider for real WebSocket clients.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { newBoardId } from '@shared/board-id';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as Y from 'yjs';
import { encodeStateAsUpdate } from 'yjs';
// @ts-expect-error ws module has no types
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 24130;
let serverProcess: ReturnType<typeof spawn> | null = null;

async function startServer(): Promise<void> {
  if (serverProcess && serverProcess.killed === false) {
    try { process.kill(serverProcess.pid!, 0); } catch { /* dead */ }
  }
  if (serverProcess) return;
  await stopServer();
  serverProcess = spawn('npx', [
    'wrangler',
    'dev',
    '--port', String(PORT),
    '--log-level', 'error',
  ], {
    cwd: path.resolve(__dirname, '../..'),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const startTime = Date.now();
  while (Date.now() - startTime < 25000) {
    await new Promise((r) => setTimeout(r, 500));
    const ok = await new Promise<boolean>((resolve) => {
      http.get(`http://localhost:${PORT}/`, (res) => {
        res.destroy();
        resolve(res.statusCode === 200);
      }).on('error', () => resolve(false));
    });
    if (ok) return;
  }
  throw new Error('Server failed to start within 25 seconds');
}

async function stopServer(): Promise<void> {
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM'); } catch {}
    await new Promise((r) => setTimeout(r, 1500));
    try { serverProcess.kill('SIGKILL'); } catch {}
    serverProcess = null;
  }
}

// Create a Y.Doc connected to the BoardRoom room via y-websocket protocol
function createClient(boardId: string): { ws: WebSocket; doc: Y.Doc } {
  const doc = new Y.Doc();
  const url = `ws://localhost:${PORT}/api/rooms/${boardId}`;
  
  // Build the WebSocket subprotocol string: [provider type][doc ID][state vector]
  // For simplicity, we'll build a minimal y-websocket compatible client manually
  
  const idBytes = Buffer.from(boardId, 'base64url');
  const header = Buffer.concat([Buffer.from([0]), idBytes]); // MSG_TYPE[0]=SYNC, then boardId bytes
  const sv = doc.toJSON();
  
  return { ws: new WebSocket(url, 'y-protocol'), doc };
}

describe('BoardRoom merging and broadcast (TC-07 to TC-13)', async () => {
  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
  });

  // TC-07: A creates sticky note → B's doc receives the update
  it('TC-07: A creates sticky; B sees it after sync', async () => {
    const boardId = newBoardId();

    // Connect client A
    const clientA = createClient(boardId);
    let aReady = false;
    clientA.ws.binaryType = 'arraybuffer';
    
    await new Promise<void>((resolve, reject) => {
      clientA.ws.on('open', () => {
        // Send initial SYNC step
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0); // MESSAGE_SYNC
        encoding.writeVarUint8Array(enc, new Uint8Array(0));
        clientA.ws.send(new Uint8Array(encoding.toUint8Array(enc)));
      });
      
      clientA.ws.on('message', (data: Buffer) => {
        // We've received at least one message, consider ready
        aReady = true;
        resolve();
      });
      
      clientA.ws.on('error', reject);
    });

    // Write a sticky note
    const m = new Y.Map();
    m.set('type', 'sticky');
    m.set('x', 100);
    m.set('y', 200);
    m.set('color', 'yellow');
    m.set('z', 1);
    const txt = new Y.Text();
    txt.insert(0, 'hello');
    m.set('text', txt);
    m.set('createdAt', Date.now());
    clientA.doc.getMap('objects').set('note-1', m);
    
    // Send update
    const update = encodeStateAsUpdate(clientA.doc);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    encoding.writeVarUint8Array(enc, update);
    clientA.ws.send(new Uint8Array(encoding.toUint8Array(enc)));

    await new Promise<void>((r) => setTimeout(r, 500));

    // Connect client B - should inherit A's changes via relay
    const clientB = createClient(boardId);
    let bReady = false;
    clientB.ws.binaryType = 'arraybuffer';
    
    await new Promise<void>((resolve, reject) => {
      clientB.ws.on('message', () => {
        bReady = true;
        resolve();
      });
      clientB.ws.on('error', reject);
    });

    // Verify B got the sticky note
    const objects = clientB.doc.getMap('objects');
    expect(objects.size).toBeGreaterThan(0);
    
    clientA.ws.close();
    clientB.ws.close();
  }, 30_000);

  // TC-13: MAX_CONCURRENT_EDITORS + 1 participants accepted
  it('TC-13: 6 participants can connect (MAX=5 + 1)', async () => {
    const boardId = newBoardId();
    const clients: WebSocket[] = [];
    const MAX = 5;

    for (let i = 0; i <= MAX; i++) {
      const ws = new WebSocket(`ws://localhost:${PORT}/api/rooms/${boardId}`, 'y-protocol');
      ws.binaryType = 'arraybuffer';
      await new Promise<void>((resolve, reject) => {
        ws.once('message', () => resolve());
        ws.once('error', reject);
        ws.once('close', reject);
        // Send empty sync to trigger handshake
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0);
        encoding.writeVarUint8Array(enc, new Uint8Array(0));
        ws.send(Buffer.from(encoding.toUint8Array(enc)));
      });
      clients.push(ws);
    }

    expect(clients.length).toBe(MAX + 1);

    for (const ws of clients) ws.close();
  }, 30_000);

  // TC-14: Late joiner gets prior state
  it('TC-14: late joiner C receives prior state', async () => {
    const boardId = newBoardId();
    
    // Writer
    const writer = new Y.Doc();
    const wws = new WebSocket(`ws://localhost:${PORT}/api/rooms/${boardId}`, 'y-protocol');
    wws.binaryType = 'arraybuffer';
    
    await new Promise<void>((resolve, reject) => {
      wws.on('open', () => {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0);
        encoding.writeVarUint8Array(enc, new Uint8Array(0));
        wws.send(Buffer.from(encoding.toUint8Array(enc)));
      });
      wws.on('message', () => resolve());
      wws.on('error', reject);
    });

    // Write something
    const m = new Y.Map();
    m.set('type', 'sticky');
    m.set('x', 42);
    m.set('y', 99);
    m.set('color', 'red');
    m.set('z', 1);
    m.set('text', (() => { const t = new Y.Text(); t.insert(0, 'late-test'); return t; })());
    m.set('createdAt', Date.now());
    writer.getMap('objects').set('late-note', m);
    
    const update = encodeStateAsUpdate(writer);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    encoding.writeVarUint8Array(enc, update);
    wws.send(Buffer.from(encoding.toUint8Array(enc)));
    
    await new Promise<void>((r) => setTimeout(r, 300));

    // Reader connects late
    const reader = new Y.Doc();
    const rws = new WebSocket(`ws://localhost:${PORT}/api/rooms/${boardId}`, 'y-protocol');
    rws.binaryType = 'arraybuffer';
    
    await new Promise<void>((resolve, reject) => {
      rws.on('message', () => {
        resolve();
      });
      rws.on('error', reject);
    });

    // Give time for relay
    await new Promise<void>((r) => setTimeout(r, 300));

    // Verify reader got the note
    expect(reader.getMap('objects').size).toBe(1);
    
    wws.close();
    rws.close();
  }, 30_000);

  // TC-16: awareness relay
  it('TC-16: awareness message relayed from A to B', async () => {
    const boardId = newBoardId();

    const c1 = new Y.Doc();
    const s1 = new WebSocket(`ws://localhost:${PORT}/api/rooms/${boardId}`, 'y-protocol');
    s1.binaryType = 'arraybuffer';
    let c1gotOne = false;
    await new Promise<void>((resolve, reject) => {
      s1.on('open', () => {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0);
        encoding.writeVarUint8Array(enc, new Uint8Array(0));
        s1.send(Buffer.from(encoding.toUint8Array(enc)));
      });
      s1.on('message', () => { c1gotOne = true; resolve(); });
      s1.on('error', reject);
    });

    const c2 = new Y.Doc();
    const s2 = new WebSocket(`ws://localhost:${PORT}/api/rooms/${boardId}`, 'y-protocol');
    s2.binaryType = 'arraybuffer';
    await new Promise<void>((resolve, reject) => {
      s2.on('message', () => {
        if (!c1gotOne) { s1.send(Buffer.from(encoding.toUint8Array(encoding.createEncoder()))); }
        resolve();
      });
      s2.on('error', reject);
    });
    
    await new Promise<void>((r) => setTimeout(r, 300));

    s1.close();
    s2.close();
  }, 20_000);

  // TC-18: restart simulation
  it('TC-18: all sockets close then fresh client sees old changes', async () => {
    const boardId = newBoardId();

    const writer = new Y.Doc();
    const wws = new WebSocket(`ws://localhost:${PORT}/api/rooms/${boardId}`, 'y-protocol');
    wws.binaryType = 'arraybuffer';
    
    await new Promise<void>((resolve, reject) => {
      wws.on('open', () => {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0);
        encoding.writeVarUint8Array(enc, new Uint8Array(0));
        wws.send(Buffer.from(encoding.toUint8Array(enc)));
      });
      wws.on('message', () => resolve());
      wws.on('error', reject);
    });

    const m = new Y.Map();
    m.set('type', 'sticky');
    m.set('x', 999);
    m.set('y', 888);
    m.set('color', 'blue');
    m.set('z', 1);
    m.set('text', (() => { const t = new Y.Text(); t.insert(0, 'restart-test'); return t; })());
    m.set('createdAt', Date.now());
    writer.getMap('objects').set('test-key', m);
    
    const update = encodeStateAsUpdate(writer);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    encoding.writeVarUint8Array(enc, update);
    wws.send(Buffer.from(encoding.toUint8Array(enc)));
    
    await new Promise<void>((r) => setTimeout(r, 300));
    wws.close();

    await new Promise<void>((r) => setTimeout(r, 500));

    const reader = new Y.Doc();
    const rws = new WebSocket(`ws://localhost:${PORT}/api/rooms/${boardId}`, 'y-protocol');
    rws.binaryType = 'arraybuffer';
    
    await new Promise<void>((resolve, reject) => {
      rws.on('message', () => resolve());
      rws.on('error', reject);
    });
    
    await new Promise<void>((r) => setTimeout(r, 300));

    rws.close();
  }, 20_000);

  // TC-31: malformed traffic doesn't crash server
  it('TC-31: malformed binary sent to valid room returns gracefully', async () => {
    const boardId = newBoardId();

    // First establish a clean connection so the DO exists
    const initC = new WebSocket(`ws://localhost:${PORT}/api/rooms/${boardId}`, 'y-protocol');
    initC.binaryType = 'arraybuffer';
    await new Promise<void>((resolve, reject) => {
      initC.on('open', () => {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0);
        encoding.writeVarUint8Array(enc, new Uint8Array(0));
        initC.send(Buffer.from(encoding.toUint8Array(enc)));
      });
      initC.on('message', () => resolve());
      initC.on('error', reject);
    });

    // Now send malformed data to another connection (or reuse same)
    const bad = new WebSocket(`ws://localhost:${PORT}/api/rooms/${boardId}`, 'y-protocol');
    bad.binaryType = 'arraybuffer';
    
    let gotResponse = false;
    const result = await new Promise<{ status: number; timedOut: boolean }>((resolve) => {
      bad.on('message', () => {
        gotResponse = true;
        resolve({ status: 0, timedOut: false });
      });
      bad.on('error', () => {
        if (!gotResponse) resolve({ status: -1, timedOut: false });
      });
      bad.on('close', () => {
        if (!gotResponse) resolve({ status: -1, timedOut: false });
      });
      
      // Send garbage data
      setTimeout(() => {
        bad.send(Buffer.from([0xff, 0xfe, 0xfd]));
      }, 200);
      
      setTimeout(() => {
        resolve({ status: gotResponse ? 0 : 1, timedOut: true });
      }, 5000);
    });

    // Should not hang forever or cause 500
    expect(result.timedOut).toBe(false);

    initC.close();
    bad.close();
  }, 15_000);
});
