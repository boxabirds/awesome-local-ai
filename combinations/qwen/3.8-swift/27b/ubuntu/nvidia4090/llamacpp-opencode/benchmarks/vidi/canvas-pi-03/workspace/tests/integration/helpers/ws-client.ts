/**
 * Integration test helper: a real Y.Doc speaking y-websocket framing over a
 * real WebSocket, talking to a BoardRoom instance directly (the same framing
 * the browser provider uses). BoardRoom uses `WebSocketPair` (no DO storage),
 * so we can instantiate it in workerd without the durable-object namespace —
 * which avoids workerd writing per-object storage files.
 *
 * It tracks the server's state vector so `waitForSync()` resolves once this
 * client has applied everything the server has (robust for late joiners).
 */
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { snapshot, type StickySnapshot } from 'src/shared/board-model';
import { MESSAGE_SYNC } from 'src/shared/protocol';
import type { BoardRoomCore } from 'src/worker/board-room';

export type ReceivedType = 'sync' | 'awareness' | 'query-awareness' | 'unknown';

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
 * Connects a real Y.Doc client to a BoardRoomCore. We create a WebSocketPair,
 * hand the server half to the room, and drive the client half directly.
 */
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

export function connectRoomClient(room: BoardRoomCore): RoomClient {
  const pair = new WebSocketPair();
  const clientSocket = pair[0];
  const server = pair[1];
  server.accept();
  room.attachSocket(server);
  const ws = clientSocket;
  ws.binaryType = 'arraybuffer';
  ws.accept();

  // The server (room) is the authority: it seeds the initial state. The client
  // starts empty and syncs from the server - mirroring the real browser client.
  const doc = new Y.Doc();

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
    sendSync: (syncMessage) => ws.send(frameSync(syncMessage)),
    sendRaw: (data) => ws.send(data),
    sendUpdate: (update) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      ws.send(encoding.toUint8Array(enc));
    },
    sendAwareness: (bytes) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 1); // MESSAGE_AWARENESS
      encoding.writeVarUint8Array(enc, bytes);
      ws.send(encoding.toUint8Array(enc));
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
    close: (code = 1000) => ws.close(code),
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
  ws.send(encoding.toUint8Array(step1));

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
      const reply = encoding.createEncoder();
      syncProtocol.readSyncMessage(decoder, reply, doc, 'remote');
      if (encoding.length(reply) > 0) {
        ws.send(frameSync(encoding.toUint8Array(reply)));
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
