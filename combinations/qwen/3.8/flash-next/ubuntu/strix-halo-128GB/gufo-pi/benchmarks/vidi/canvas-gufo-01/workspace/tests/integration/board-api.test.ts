// Integration tests: the real Worker entry point, the real BoardRoom Durable
// Object (SQLite storage) and the real y-protocols framing, all inside workerd.
//
// TC-05 .. TC-15, TC-32 from spec/stories/005-share-a-board-with-others-using-a-link/design.md

import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { decodeMessage, MESSAGE_SYNC, syncStep1Message, updateMessage } from '../../src/shared/protocol';
import { createSticky, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import type { BoardRoom } from '../../src/worker/board-room';
import type { BoardStore } from '../../src/worker/board-store';
import { createBoard } from '../../src/worker/create-board';

const ORIGIN = 'http://worker.test';

/** Every test uses its own visitor key so the shared rate limiter never bleeds across tests. */
let visitorSeq = 0;
function visitor(): Record<string, string> {
  visitorSeq += 1;
  return { 'X-Forwarded-For': `10.44.${visitorSeq >> 8}.${visitorSeq & 0xff}` };
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, init);
}

async function createBoardViaApi(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await api('/api/boards', { method: 'POST', headers: visitor() });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

interface StoreView {
  tables: string[];
  createdAt: number | null;
  updateCount: number;
}

function inspectStore(stub: DurableObjectStub<BoardRoom>): Promise<StoreView> {
  return runInDurableObject(stub, async (room: BoardRoom) => {
    const store = (room as unknown as { store: BoardStore }).store;
    const tables = store.listTables();
    const rows = tables.includes('updates') ? store['storage'].sql.exec(`SELECT seq FROM updates`).toArray() : [];
    return { tables, createdAt: store.createdAt(), updateCount: rows.length };
  });
}

function stubFor(boardId: string): DurableObjectStub<BoardRoom> {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/** A seeded legacy update: one sticky note written by a "previous version". */
function legacyUpdate(): { b64: string; note: StickySnapshot } {
  const doc = new Y.Doc();
  const id = createSticky(doc, { x: 120, y: -40 }, 'blue');
  const note = snapshot(doc).find((n) => n.id === id)!;
  const update = Y.encodeStateAsUpdate(doc);
  let binary = '';
  for (const byte of update) binary += String.fromCharCode(byte);
  return { b64: btoa(binary), note };
}

interface RoomClient {
  readonly socket: WebSocket;
  nextFrame(timeoutMs?: number): Promise<ArrayBuffer | string>;
  frames(): (ArrayBuffer | string)[];
  close(code?: number): void;
}

async function connectRoom(boardId: string): Promise<{ response: Response; client: RoomClient }> {
  const response = await SELF.fetch(`${ORIGIN}/api/rooms/${boardId}`, {
    headers: {
      ...visitor(),
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version': '13',
    },
  });
  const socket = response.webSocket;
  if (!socket) {
    return {
      response,
      client: {
        socket: null as unknown as WebSocket,
        nextFrame: async () => {
          throw new Error(`no socket (status ${response.status})`);
        },
        frames: () => [],
        close: () => undefined,
      },
    };
  }
  socket.accept();
  socket.binaryType = 'arraybuffer';
  const received: (ArrayBuffer | string)[] = [];
  const waiters: ((frame: ArrayBuffer | string) => void)[] = [];
  const push = (frame: ArrayBuffer | string): void => {
    const waiter = waiters.shift();
    if (waiter) waiter(frame);
    else received.push(frame);
  };
  socket.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as ArrayBuffer | string | Blob;
    if (typeof data !== 'string' && data instanceof Blob) {
      void data.arrayBuffer().then(push);
      return;
    }
    push(data as ArrayBuffer | string);
  });
  const client: RoomClient = {
    socket,
    nextFrame: (timeoutMs = 3000) =>
      new Promise<ArrayBuffer | string>((resolveFn, rejectFn) => {
        if (received.length > 0) {
          resolveFn(received.shift()!);
          return;
        }
        const timer = setTimeout(() => rejectFn(new Error('timed out waiting for a frame')), timeoutMs);
        waiters.push((frame) => {
          clearTimeout(timer);
          resolveFn(frame);
        });
      }),
    frames: () => received,
    close: (code = 1000) => {
      try {
        socket.close(code);
      } catch {
        /* already gone */
      }
    },
  };
  return { response, client };
}

/** Client-side Y.Doc that speaks the room protocol over `client`. */
class SyncClient {
  readonly doc = new Y.Doc();

  constructor(private readonly client: RoomClient) {
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return; // applied from the room, nothing to echo back
      void this.client.socket.send(updateMessage(update));
    });
  }

  /** Read one server frame, apply it, and send whatever sync replies it asks for. */
  private async pump(timeoutMs = 3000): Promise<void> {
    const frame = await this.client.nextFrame(timeoutMs);
    const decoded = decodeMessage(frame as ArrayBuffer);
    if (decoded.kind !== 'sync') {
      throw new Error(`expected a sync frame, got ${decoded.kind} (${decoded.kind === 'invalid' ? decoded.reason : ''})`);
    }
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(decoding.createDecoder(decoded.payload), reply, this.doc, this);
    const bytes = encoding.toUint8Array(reply);
    if (bytes.length > 1) await this.client.socket.send(bytes);
  }

  /**
   * y-websocket handshake: the room sends its SyncStep1 on connect; the client
   * answers it (pump) and then asks for the room's state with its own
   * SyncStep1, which is what actually delivers the board content.
   */
  async handshake(): Promise<void> {
    await this.pump();
    await this.client.socket.send(syncStep1Message(this.doc));
  }

  async waitForNotes(count: number, timeoutMs = 3000): Promise<readonly StickySnapshot[]> {
    const deadline = Date.now() + timeoutMs;
    while (snapshot(this.doc).length < count) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        await this.pump(remaining);
      } catch {
        break; // no further frames within the budget
      }
    }
    return snapshot(this.doc);
  }

  addNote(at: { x: number; y: number }): string {
    return createSticky(this.doc, at, 'pink');
  }
}

const openClients: RoomClient[] = [];
const createdRoomIds: string[] = [];

function track(client: RoomClient): RoomClient {
  openClients.push(client);
  return client;
}

afterEach(() => {
  while (openClients.length) openClients.pop()!.close();
  createdRoomIds.length = 0;
});

describe('POST /api/boards and GET /api/boards/:id', () => {
  it('TC-05 creates a board, the link then reports it as existing, and created_at is written', async () => {
    const { status, body } = await createBoardViaApi();
    expect(status).toBe(201);
    const id = body['id'] as string;
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    createdRoomIds.push(id);

    const check = await api(`/api/boards/${id}`);
    expect(check.status).toBe(200);
    expect(await check.json()).toEqual({ id });

    const view = await inspectStore(stubFor(id));
    expect(view.tables).toContain('storage_meta');
    expect(typeof view.createdAt).toBe('number');
    expect(Math.abs((view.createdAt as number) - Date.now())).toBeLessThan(60_000);
  });

  it('TC-06 reports an unknown but well-formed id as 404 and leaves no tables behind', async () => {
    const id = newBoardId();
    const res = await api(`/api/boards/${id}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });

    const view = await inspectStore(stubFor(id));
    expect(view.tables).toEqual([]);
    expect(view.createdAt).toBeNull();
  });

  it('TC-07 answers malformed ids with 404 without touching the namespace', async () => {
    const calls: string[] = [];
    const real = env.BOARD_ROOM;
    const spy = new Proxy(real, {
      get(target, property, receiver) {
        calls.push(String(property));
        return Reflect.get(target, property, receiver);
      },
    });
    (env as unknown as Record<string, unknown>)['BOARD_ROOM'] = spy;
    try {
      const malformed = [
        '',
        'short',
        newBoardId().slice(0, 21),
        `${newBoardId()}x`,
        'has spaces here xxxx',
        'HasUpperCaseXXXX XXXXXX',
        'dots.and.slashes/../..',
        '%20%20%20%20%20%20%20%20%20%20%20%20',
      ];
      for (const id of malformed) {
        const res = await api(`/api/boards/${encodeURIComponent(id)}`);
        expect(res.status, `id ${JSON.stringify(id)}`).toBe(404);
        const room = await api(`/api/rooms/${encodeURIComponent(id)}`, {
          headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
        });
        expect(room.status, `room ${JSON.stringify(id)}`).toBe(404);
      }
      expect(calls).toEqual([]);
    } finally {
      (env as unknown as Record<string, unknown>)['BOARD_ROOM'] = real;
    }
  });

  it('TC-12 returns 500 create_failed when the Durable Object RPC throws', async () => {
    const real = env.BOARD_ROOM;
    const failing = {
      idFromName: (name: string) => real.idFromName(name),
      get: () =>
        ({
          initialize: async () => {
            throw new Error('storage unavailable');
          },
        }) as unknown as ReturnType<typeof real.get>,
    } as unknown as typeof real;
    (env as unknown as Record<string, unknown>)['BOARD_ROOM'] = failing;
    try {
      const res = await api('/api/boards', { method: 'POST', headers: visitor() });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'create_failed' });
    } finally {
      (env as unknown as Record<string, unknown>)['BOARD_ROOM'] = real;
    }
  });

  it('TC-11 hands out a fresh id when a generated id collides, leaving the existing board alone', async () => {
    const first = await createBoardViaApi();
    const existing = first.body['id'] as string;
    const before = await inspectStore(stubFor(existing));

    // The generator yields the taken id first, then a free one.
    const queue = [existing, newBoardId()];
    const result = await createBoard(env, `collision-${visitorSeq}`, () => queue.shift() ?? newBoardId());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.id).not.toBe(existing);
    expect(result.id).toMatch(/^[A-Za-z0-9_-]{22}$/);

    // The board that was already there must not have been re-initialised.
    const after = await inspectStore(stubFor(existing));
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.createdAt).not.toBeNull();
  });

  it('TC-14 refuses other methods on the board endpoints with 405', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const res = await api(`/api/boards`, { method, headers: visitor() });
      expect(res.status, method).toBe(405);
      expect(await res.json()).toEqual({ error: 'method_not_allowed' });
    }
  });

  it('TC-13 blocks the 11th create from one visitor within the window', async () => {
    // Uses the real `ratelimits` binding as simulated locally by the Workers
    // runtime (not a fake Limiter): the local simulator honours the per-key
    // window, which is exactly what this boundary needs.
    const headers = visitor();
    for (let i = 0; i < 10; i++) {
      const res = await api('/api/boards', { method: 'POST', headers });
      expect(res.status, `attempt ${i + 1}`).toBe(201);
      const body = (await res.json()) as { id: string };
      createdRoomIds.push(body.id);
    }
    const blocked = await api('/api/boards', { method: 'POST', headers });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'rate_limited' });

    // A different visitor is unaffected.
    const other = await createBoardViaApi();
    expect(other.status).toBe(201);
    createdRoomIds.push(other.body['id'] as string);
  });
});

describe('GET /api/rooms/:id', () => {
  it('TC-09 refuses to upgrade an unknown board: 404, no socket', async () => {
    const id = newBoardId();
    const { response, client } = await connectRoom(id);
    expect(response.status).toBe(404);
    expect(response.webSocket).toBeFalsy();
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(client.socket).toBeNull();

    const view = await inspectStore(stubFor(id));
    expect(view.tables).toEqual([]);
  });

  it('TC-10 upgrades a known board and syncs both ways', async () => {
    const { id } = await (await api('/api/boards', { method: 'POST', headers: visitor() })).json() as { id: string };
    createdRoomIds.push(id);

    const { response, client } = await connectRoom(id);
    track(client);
    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();

    const peer = new SyncClient(client);
    await peer.handshake();

    // Server-side edit reaches the client within the live budget.
    const started = Date.now();
    const serverNoteId = await runInDurableObject(stubFor(id), (room: BoardRoom) => {
      const live = (room as unknown as { live: { doc: Y.Doc } | null }).live;
      const doc = live!.doc;
      return createSticky(doc, { x: 500, y: 250 }, 'green');
    });
    const notes = await peer.waitForNotes(1);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(notes.map((n) => n.id)).toContain(serverNoteId);
    expect(notes[0]).toMatchObject({ x: 500, y: 250, color: 'green' });

    // Client-side edit reaches the authoritative doc.
    const clientNoteId = peer.addNote({ x: -700, y: 900 });
    await waitFor(async () => {
      const ids = await runInDurableObject(stubFor(id), (room: BoardRoom) =>
        snapshot((room as unknown as { live: { doc: Y.Doc } }).live!.doc).map((n) => n.id),
      );
      return ids.includes(clientNoteId);
    });
    const persisted = await runInDurableObject(stubFor(id), (room: BoardRoom) =>
      snapshot((room as unknown as { live: { doc: Y.Doc } }).live!.doc),
    );
    expect(persisted.map((n) => n.id)).toContain(clientNoteId);
  });
});

describe('legacy boards (content but no created_at)', () => {
  it('TC-08 reports a legacy board as existing', async () => {
    const id = newBoardId();
    const { b64 } = legacyUpdate();
    await stubFor(id).seedLegacy([b64]);

    const res = await api(`/api/boards/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id });

    const view = await inspectStore(stubFor(id));
    expect(view.updateCount).toBeGreaterThan(0);
    expect(view.createdAt).toBeNull();
  });

  it('TC-08 opens a legacy board over WebSocket and syncs its notes', async () => {
    const id = newBoardId();
    const { b64, note } = legacyUpdate();
    await stubFor(id).seedLegacy([b64]);

    const { response, client } = await connectRoom(id);
    track(client);
    expect(response.status).toBe(101); // a legacy board is openable, not "not found"
    const peer = new SyncClient(client);
    await peer.handshake();
    const notes = await peer.waitForNotes(1);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: note.id, x: 120, y: -40, color: 'blue', text: note.text });
  });

  it('TC-15 initialize() on a legacy board says exists and writes no created_at', async () => {
    const id = newBoardId();
    const { b64 } = legacyUpdate();
    const stub = stubFor(id);
    await stub.seedLegacy([b64]);

    const result = await stub.initialize();
    expect(result).toBe('exists');

    const view = await inspectStore(stub);
    expect(view.createdAt).toBeNull();
    expect(view.updateCount).toBe(1);
  });
});

describe('served document', () => {
  it('TC-32 keeps the board link out of the referrer with a no-referrer meta tag', async () => {
    for (const path of ['/', '/b/' + newBoardId()]) {
      const res = await api(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(
        html,
        `${path} is missing <meta name="referrer" content="no-referrer">`,
      ).toMatch(/<meta\s+name=["']referrer["']\s+content=["']no-referrer["']\s*\/?>/i);
    }
  });
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error('condition never became true');
    await new Promise((resolveFn) => setTimeout(resolveFn, 20));
  }
}
