/**
 * The board's websocket client: `y-websocket`'s `WebsocketProvider` class as it is,
 * with four changes (design "The client's side of a failed load"):
 *
 * 1. close code `CLOSE_BOARD_LOAD_FAILED` is a load failure, not a successful
 *    connection — it is reported as `loadfailed` (and, matching the 4500-4599
 *    "try again later" convention, reconnection continues underneath);
 * 2. at least one Sync confirmation per retry interval — a socket that has been open
 *    for `LOAD_RETRY_MIN_INTERVAL_MS` without ever syncing is dropped and replaced,
 *    so an accepted-but-useless connection cannot sit there looking healthy;
 * 3. the never-opened-socket case belongs to `connectBoard`, which owns the badge
 *    timeout (`BOARD_LOAD_TIMEOUT_MS`) while this socket keeps trying in the background;
 * 4. the watchdog for an open-but-unconfirmed socket is the same timer as 2: sync
 *    confirmation is what "confirmed" means.
 *
 * Cross-tab BroadcastChannel is not part of this provider at all: two tabs of the
 * same board talk to the room like any two people would (story 3).
 */
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as math from 'lib0/math';
import * as time from 'lib0/time';
import * as Y from 'yjs';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
} from '../../shared/protocol';

/** No message from the server for this long means the connection is gone (y-websocket's value). */
const MESSAGE_RECONNECT_TIMEOUT_MS = 30_000;

export type BoardSocketStatus = 'connecting' | 'connected' | 'disconnected';

export interface BoardSocketEvents {
  onStatus(status: BoardSocketStatus): void;
  onSync(synced: boolean): void;
  /** The room closed the socket saying this board could not be loaded (4500). */
  onLoadFailed(): void;
}

export interface BoardSocketOptions extends BoardSocketEvents {
  /** Ceiling of the exponential reconnect backoff (`RECONNECT_MAX_BACKOFF_MS`). */
  maxBackoffTime: number;
  /** Injected so tests hold the socket; defaults to the browser's. */
  WebSocketPolyfill?: typeof WebSocket;
  awareness?: awarenessProtocol.Awareness;
}

type Socket = WebSocket & { binaryType: string };

/**
 * One board's connection: sends what the local doc did, applies what the room sends,
 * reconnects with capped exponential backoff. Synced means the room answered our
 * `SyncStep1` with its `SyncStep2` — the one fact every badge in story 4 is built on.
 */
export class BoardSocket {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly url: string;
  shouldConnect = true;
  wsconnected = false;
  wsconnecting = false;
  synced = false;

  private readonly events: BoardSocketEvents;
  private readonly maxBackoffTime: number;
  private readonly WS: typeof WebSocket;
  private ws: Socket | null = null;
  private unsuccessfulReconnects = 0;
  private lastMessageReceived = 0;
  private syncDeadline: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(serverUrl: string, roomname: string, doc: Y.Doc, opts: BoardSocketOptions) {
    this.doc = doc;
    this.awareness = opts.awareness ?? new awarenessProtocol.Awareness(doc);
    this.url = `${serverUrl.replace(/\/$/, '')}/${roomname}`;
    this.events = {
      onStatus: opts.onStatus,
      onSync: opts.onSync,
      onLoadFailed: opts.onLoadFailed,
    };
    this.maxBackoffTime = opts.maxBackoffTime;
    this.WS = opts.WebSocketPolyfill ?? WebSocket;

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder));
    });
    this.awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changedClients = added.concat(updated).concat(removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
      );
        this.broadcast(encoding.toUint8Array(encoder));
      },
    );

    // The watchdog for change 4 (which is change 2 in waiting): an open connection
    // that stops producing any traffic is gone, whatever it thinks it is.
    this.watchdog = setInterval(() => {
      if (
        this.wsconnected &&
        MESSAGE_RECONNECT_TIMEOUT_MS < time.getUnixTime() - this.lastMessageReceived
      ) {
        this.closeSocket(this.ws);
      }
    }, MESSAGE_RECONNECT_TIMEOUT_MS / 10);

    this.connect();
  }

  disconnect(): void {
    this.shouldConnect = false;
    this.closeSocket(this.ws);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.watchdog !== null) clearInterval(this.watchdog);
    this.disconnect();
  }

  private connect(): void {
    if (!this.shouldConnect || this.ws !== null) return;
    const socket = new this.WS(this.url) as Socket;
    socket.binaryType = 'arraybuffer';
    this.ws = socket;
    this.wsconnecting = true;
    this.wsconnected = false;
    this.setSynced(false);
    socket.onmessage = (event: MessageEvent) => {
      if (this.ws !== socket) return;
      this.lastMessageReceived = time.getUnixTime();
      const encoder = this.readMessage(new Uint8Array(event.data as ArrayBuffer));
      if (encoding.length(encoder) > 1) socket.send(encoding.toUint8Array(encoder));
    };
    socket.onerror = () => {
      // Swallowed: a failed connection attempt is reported by the close event that
      // follows it, and in a browser there is nothing more to see here.
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.ws !== socket) return;
      this.onClose(event);
    };
    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.lastMessageReceived = time.getUnixTime();
      this.wsconnecting = false;
      this.wsconnected = true;
      this.events.onStatus('connected');
      // Always send sync step 1 when connected; the room's SyncStep2 back is the
      // confirmation the retry watchdog below waits for.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      socket.send(encoding.toUint8Array(encoder));
      if (this.awareness.getLocalState() !== null) {
        const awarenessEncoder = encoding.createEncoder();
        encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          awarenessEncoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
        );
        socket.send(encoding.toUint8Array(awarenessEncoder));
      }
      // Changes 2 and 4: a connection that has not confirmed a single Sync within
      // `LOAD_RETRY_MIN_INTERVAL_MS` is not a working connection, and gets replaced.
      this.clearSyncDeadline();
      this.syncDeadline = setTimeout(() => {
        this.syncDeadline = null;
        if (!this.synced) this.closeSocket(socket);
      }, LOAD_RETRY_MIN_INTERVAL_MS);
    };
    this.events.onStatus('connecting');
  }

  private onClose(event: CloseEvent): void {
    const socket = this.ws;
    if (socket === null) return;
    this.ws = null;
    this.wsconnecting = false;
    this.clearSyncDeadline();
    if (this.wsconnected) {
      this.wsconnected = false;
      this.setSynced(false);
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        Array.from(this.awareness.getStates().keys()).filter((client) => client !== this.doc.clientID),
        this,
      );
      this.events.onStatus('disconnected');
    }
    // Change 1: 4500 is the room telling us this board could not be loaded. It is a
    // load failure, not a successful connection — and not the end either: the room
    // retries its own load at most once per `LOAD_RETRY_MIN_INTERVAL_MS`, so this
    // client keeps the attempts coming (backoff capped at the same interval).
    if (event.code === CLOSE_BOARD_LOAD_FAILED) {
      this.events.onLoadFailed();
    }
    this.unsuccessfulReconnects++;
    if (this.destroyed || !this.shouldConnect) return;
    setTimeout(
      () => this.connect(),
      Math.min(math.pow(2, this.unsuccessfulReconnects) * 100, this.maxBackoffTime),
    );
  }

  private readMessage(buf: Uint8Array): encoding.Encoder {
    const decoder = decoding.createDecoder(buf);
    const encoder = encoding.createEncoder();
    const messageType = decoding.readVarUint(decoder);
    if (messageType === MESSAGE_SYNC) {
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      const syncType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
      if (syncType === syncProtocol.messageYjsSyncStep2 && !this.synced) this.setSynced(true);
    } else if (messageType === MESSAGE_QUERY_AWARENESS) {
      // The room's keepalive asks; we answer with our awareness, as `y-websocket` does.
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(this.awareness.getStates().keys())),
      );
    } else if (messageType === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
    }
    return encoder;
  }

  private setSynced(state: boolean): void {
    if (this.synced === state) return;
    this.synced = state;
    if (state) this.unsuccessfulReconnects = 0; // a connection that synced earned its backoff reset
    this.clearSyncDeadline();
    this.events.onSync(state);
  }

  private clearSyncDeadline(): void {
    if (this.syncDeadline !== null) {
      clearTimeout(this.syncDeadline);
      this.syncDeadline = null;
    }
  }

  private broadcast(bytes: Uint8Array): void {
    const socket = this.ws;
    if (this.wsconnected && socket !== null && socket.readyState === WebSocket.OPEN) {
      socket.send(bytes);
    }
  }

  private closeSocket(socket: Socket | null): void {
    if (socket === null) return;
    if (this.ws === socket) {
      this.ws = null;
      socket.onmessage = null;
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = () => {};
      socket.close();
      this.wsconnecting = false;
      if (this.wsconnected) {
        this.wsconnected = false;
        this.setSynced(false);
        this.events.onStatus('disconnected');
      }
      if (!this.destroyed && this.shouldConnect) {
        // A local close is not a signal from the server: try again, backoff included.
        this.unsuccessfulReconnects++;
        setTimeout(
          () => this.connect(),
          Math.min(math.pow(2, this.unsuccessfulReconnects) * 100, this.maxBackoffTime),
        );
      }
    } else {
      try {
        socket.close();
      } catch {
        // Already gone.
      }
    }
  }
}
