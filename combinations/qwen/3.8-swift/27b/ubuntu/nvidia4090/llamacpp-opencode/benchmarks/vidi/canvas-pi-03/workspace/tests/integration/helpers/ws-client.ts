/**
 * Integration test helper: a real Y.Doc speaking y-websocket framing over a
 * real WebSocket, talking to the board's BoardRoom Durable Object through the
 * real worker route (`/api/rooms/<boardId>`). This exercises the full hibernation
 * path: `ctx.acceptWebSocket` on the server, real sync/awareness, real SQLite.
 *
 * It tracks the server's state vector so `waitForSync()` resolves once this
 * client has applied everything the server has (robust for late joiners).
 */
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { SELF } from 'cloudflare:test';
import { snapshot, type StickySnapshot } from 'src/shared/board-model';
import { MESSAGE_SYNC } from 'src/shared/protocol';

export type ReceivedType = 'sync' | 'awareness' | 'query-awareness' | 'unknown';

/**
 * Local workerd does not truly hibernate: every constructed BoardRoom keeps its
 * Y.Doc + SQLite storage cache resident until the ~10 s idle eviction. The DO
 * isolate's storage cache overflows at ~11 live objects, after which creating a
 * new object hangs. So we cap how many boards are alive at once: once we've
 * created `EVICTION_BATCH` boards (and their sockets are closed), we pause just
 * past the idle-eviction timeout so the objects are released before the next is
 * constructed. This keeps the live count safely under the limit.
 */
const EVICTION_BATCH = 7;
const EVICTION_WAIT_MS = 12_000;
// Unique boards constructed since the last eviction. A board with many clients
// counts once, so a 101-socket test does not trigger spurious evictions. The
// set is only ever cleared by an eviction, so it may slightly over-count
// already-evicted boards — that just evicts a little early (safe).
const liveBoardIds = new Set<string>();

export interface RoomClient {
  doc: Y.Doc;
  ws: WebSocket;
  /** Raw frames received, in order. */
  received: { type: ReceivedType; data: Uint8Array }[];
  /** Close code once the socket closes (null while open). */
  closeCode: number | null;
  closeReason: string;
  /** Number of remote updates applied to this client's doc. */
  remoteUpdates: number;
  closed: Promise<number>;
  /** DEBUG: the server state vector captured from the first SyncStep1. */
  serverSV: () => Uint8Array | null;
  sendSync: (syncMessage: Uint8Array) => void;
  sendRaw: (data: Uint8Array | string) => void;
  sendUpdate: (update: Uint8Array) => void;
  sendAwareness: (bytes: Uint8Array) => void;
  /** When true, local edits are queued (not sent) until `flushHeld()`. */
  holding: boolean;
  heldUpdates: Uint8Array[];
  flushHeld: () => void;
  snapshot: () => readonly StickySnapshot[];
  isConnected: () => boolean;
  close: (code?: number) => void;
  waitForSync: () => Promise<void>;
  waitFor: (predicate: () => boolean, opts?: { timeout?: number; interval?: number }) => Promise<void>;
}

const OUTER_TYPE: Record<number, ReceivedType> = {
  0: 'sync',
  1: 'awareness',
  3: 'query-awareness',
};

/** Frames a raw sync message as a y-websocket sync frame (type 0 + raw tail). */
function frameSync(syncMessage: Uint8Array): Uint8Array {
  const header = encoding.encode((enc) => encoding.writeVarUint(enc, MESSAGE_SYNC));
  const out = new Uint8Array(header.length + syncMessage.length);
  out.set(header, 0);
  out.set(syncMessage, header.length);
  return out;
}

/**
 * A client is considered synced with the server's initial state once its own
 * state vector *covers* the server state vector captured at attach time: for
 * every (client, clock) the server reported, the client has that client at an
 * equal-or-higher clock. Coverage (not equality) is used because the server's
 * state can advance after attach (a peer may add notes) — the client then has
 * a superset, which is fully synced.
 */
function svCovers(client: Uint8Array, server: Uint8Array): boolean {
  const serverMap = decodeStateVector(server);
  const clientMap = decodeStateVector(client);
  for (const [id, clock] of serverMap) {
    const c = clientMap.get(id);
    if (c === undefined || c < clock) return false;
  }
  return true;
}

/** Decode a Yjs state vector into a Map<clientId, clock>. */
function decodeStateVector(sv: Uint8Array): Map<number, number> {
  const dec = decoding.createDecoder(sv);
  const count = decoding.readVarUint(dec);
  const m = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const id = decoding.readVarUint(dec);
    const clock = decoding.readVarUint(dec);
    m.set(id, clock);
  }
  return m;
}

/**
 * Connects a real Y.Doc client to the board's BoardRoom via the real worker
 * route. The server (room) is the authority: it seeds the initial state. The
 * client starts empty and syncs from the server — mirroring the real browser.
 */
/**
 * Call from an `afterEach` hook (between tests, not mid-test): if we've
 * constructed enough boards, pause just past the idle-eviction timeout so the
 * workerd DO isolate releases them before the next test constructs more. This
 * keeps the live-object count under the isolate limit without stalling a test.
 */
export async function settleBoards(): Promise<void> {
  if (liveBoardIds.size >= EVICTION_BATCH) {
    liveBoardIds.clear();
    await new Promise((r) => setTimeout(r, EVICTION_WAIT_MS));
  }
}

/**
 * Story 5: rooms are no longer created implicitly by connecting — the board
 * must exist first. These helpers (integration tests only, TEST_HOOKS=1) mark
 * the board created via the gated `initialize` test op, which is idempotent
 * ('created' then 'exists'). This mirrors what POST /api/boards does in the
 * real flow without consuming rate-limit budget.
 */
export async function ensureBoardInitialized(boardId: string): Promise<void> {
  const res = await SELF.fetch(`http://localhost/__test/boards/${boardId}/initialize`, {
    method: 'POST',
  });
  if (res.status !== 200) {
    throw new Error(`failed to initialize board ${boardId}: ${res.status}`);
  }
  await res.json();
}

export async function connectRoomClient(
  boardId: string,
  existingDoc?: Y.Doc,
): Promise<RoomClient> {
  // Track unique boards constructed (used by settleBoards to schedule eviction).
  liveBoardIds.add(boardId);
  // Story 5: the room refuses unknown boards; make sure this one exists.
  await ensureBoardInitialized(boardId);

  const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
    headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
  });
  if (res.status !== 101 || !res.webSocket) {
    throw new Error(`expected websocket upgrade, got ${res.status}`);
  }
  const ws = res.webSocket;
  ws.binaryType = 'arraybuffer';
  ws.accept();

  // Sends from event handlers (message / doc-update) can fire after the socket
  // closes. In workerd, `send()` on a closed socket THROWS; uncaught, it
  // corrupts the whole runtime and every later Durable Object creation hangs.
  // Guard every send with a readyState check + catch.
  const safeSend = (data: Uint8Array | string) => {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(data);
    } catch {
      /* socket closed concurrently — safe to ignore */
    }
  };

  // Reconnect can reuse an existing doc (preserving local/unsaved changes),
  // mirroring the real browser which keeps its Y.Doc across reconnects.
  const doc = existingDoc ?? new Y.Doc();

  let serverSV: Uint8Array | null = null;
  const heldUpdates: Uint8Array[] = [];
  let closeResolve: (code: number) => void;
  const closed = new Promise<number>((resolve) => {
    closeResolve = resolve;
  });

  const client: RoomClient = {
    doc,
    ws,
    received: [],
    closeCode: null,
    closeReason: '',
    remoteUpdates: 0,
    closed,
    serverSV: () => serverSV,
    sendSync: (syncMessage) => safeSend(frameSync(syncMessage)),
    sendRaw: (data) => safeSend(data),
    sendUpdate: (update) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      safeSend(encoding.toUint8Array(enc));
    },
    sendAwareness: (bytes) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 1); // MESSAGE_AWARENESS
      encoding.writeVarUint8Array(enc, bytes);
      safeSend(encoding.toUint8Array(enc));
    },
    holding: false,
    heldUpdates,
    flushHeld: () => {
      const held = client.heldUpdates.slice();
      client.heldUpdates.length = 0;
      for (const u of held) client.sendUpdate(u);
    },
    snapshot: () => snapshot(doc),
    isConnected: () => ws.readyState === ws.OPEN,
    // Fire-and-forget: with the hibernation API the close is deferred until the
    // object is idle-evicted (~10 s), so awaiting it would stall every test.
    close: (code = 1000) => {
      ws.close(code);
    },
    waitForSync: () =>
      client.waitFor(
        () =>
          serverSV !== null &&
          svCovers(Y.encodeStateVector(doc), serverSV),
        { timeout: 10000 },
      ),
    waitFor: (predicate, opts = {}) => poll(predicate, opts),
  };

  // Client initiates the sync with its own SyncStep1.
  const step1 = encoding.createEncoder();
  encoding.writeVarUint(step1, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(step1, doc);
  safeSend(encoding.toUint8Array(step1));

  // Local edits -> send to the server (or queued when `holding`). Remote
  // updates are applied with origin 'remote' and are NOT echoed back.
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') {
      client.remoteUpdates += 1;
      return;
    }
    if (client.holding) {
      client.heldUpdates.push(update);
      return;
    }
    if (ws.readyState !== ws.OPEN) return;
    client.sendUpdate(update);
  });

  ws.addEventListener('message', (e: MessageEvent) => {
    const bytes = new Uint8Array(e.data as ArrayBuffer);
    const type = OUTER_TYPE[bytes[0]] ?? 'unknown';
    client.received.push({ type, data: bytes });

    if (bytes[0] === MESSAGE_SYNC) {
      const decoder = decoding.createDecoder(bytes);
      decoding.readVarUint(decoder); // consume outer type
      // Capture the server state vector from a SyncStep1. The SV follows the
      // inner type byte, so advance a throwaway clone past it before reading.
      const innerType = decoding.readVarUint(decoding.clone(decoder));
      if (innerType === 0) {
        const svClone = decoding.clone(decoder);
        decoding.readVarUint(svClone); // skip the inner type byte
        const sv = decoding.readVarUint8Array(svClone);
        if (serverSV === null) serverSV = sv;
      }

      // Apply the sync message (SyncStep2 / update) to the local doc.
      const reply = encoding.createEncoder();
      syncProtocol.readSyncMessage(decoder, reply, doc, 'remote');
      if (encoding.length(reply) > 0) {
        safeSend(frameSync(encoding.toUint8Array(reply)));
      }
    }
  });

  ws.addEventListener('close', (e: CloseEvent) => {
    client.closeCode = e.code;
    client.closeReason = e.reason;
    closeResolve(e.code);
  });

  return client;
}

async function poll(
  predicate: () => boolean,
  opts: { timeout?: number; interval?: number },
): Promise<void> {
  const timeout = opts.timeout ?? 5000;
  const interval = opts.interval ?? 10;
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error('waitFor timed out');
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
