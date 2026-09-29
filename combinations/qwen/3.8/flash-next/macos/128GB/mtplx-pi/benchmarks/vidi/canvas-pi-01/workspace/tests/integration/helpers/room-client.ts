/**
 * Story 4 · a scriptable collab client for the workerd integration tests.
 *
 * It speaks the same framing as the real `y-websocket` provider (a
 * `[0, 0, …]` SyncStep1, `[0, 1, …]` update) and does the story 3 handshake
 * automatically: every sync frame it receives is fed to
 * `syncProtocol.readSyncMessage` and any reply is sent back. That way a test
 * can drive a *client-side* `Y.Doc` against the real `BoardRoom` — including
 * "a client that reconnects still holding a change" — without a browser.
 */
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';

/** Wrap an update as a y-websocket sync-update frame (message 0, sub-type 1). */
export function updateFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** Wrap an arbitrary payload as an awareness frame (message type 1). */
export function awarenessFrame(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

/** Build a SyncStep1 frame (state vector) — how a provider opens a connection. */
export function syncStep1Frame(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

export class RoomClient {
  readonly doc: Y.Doc;
  /** Every frame received from the room, in order. */
  readonly frames: Uint8Array[] = [];
  /** Close codes observed on the client end of the socket. */
  readonly closeCodes: number[] = [];
  readonly socket: WebSocket;

  constructor(socket: WebSocket, doc?: Y.Doc) {
    this.doc = doc ?? new Y.Doc();
    this.socket = socket;
    this.socket.binaryType = 'arraybuffer';
    this.socket.addEventListener('message', (event: MessageEvent) => {
      const frame = new Uint8Array(event.data as ArrayBuffer);
      this.frames.push(frame);
      // Answer a SyncStep1 (or any sync frame) exactly like the provider does:
      // let y-protocols compute the difference and send it back.
      if (frame[0] !== 0) return;
      const decoder = decoding.createDecoder(frame.subarray(1));
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      try {
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, null);
      } catch {
        return; // Deliberately-garbage frames are the room's problem, not ours.
      }
      if (encoding.length(encoder) > 1) this.send(encoding.toUint8Array(encoder));
    });
    this.socket.addEventListener('close', (event: CloseEvent) => {
      this.closeCodes.push(event.code);
    });
    // The real provider opens with its own SyncStep1; the room answers with a
    // SyncStep2 carrying whatever it has. Without this, a reconnecting client
    // only ever receives what the room pushes later.
    this.send(syncStep1Frame(this.doc));
  }

  get closed(): boolean {
    return this.socket.readyState !== WebSocket.OPEN;
  }

  send(bytes: Uint8Array): void {
    this.socket.send(bytes.slice().buffer as ArrayBuffer);
  }

  /** Send every change `mutate` makes to the client doc, one frame each. */
  push(mutate: (doc: Y.Doc) => void): void {
    const updates: Uint8Array[] = [];
    const listener = (update: Uint8Array): void => {
      updates.push(update.slice());
    };
    this.doc.on('update', listener);
    mutate(this.doc);
    this.doc.off('update', listener);
    for (const update of updates) this.send(updateFrame(update));
  }

  /** Wait until `predicate` holds (or `timeoutMs` passes). */
  async waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return predicate();
  }

  /** Wait for `count` frames (the greeting counts). */
  waitForFrames(count: number, timeoutMs = 3000): Promise<boolean> {
    return this.waitUntil(() => this.frames.length >= count, timeoutMs);
  }

  waitForClose(timeoutMs = 3000): Promise<boolean> {
    return this.waitUntil(() => this.closeCodes.length > 0, timeoutMs);
  }

  /**
   * Frames carrying board content: SyncStep2 (sub-type 1) and update (2).
   * `y-protocols` numbers them `messageYjsSyncStep2` / `messageYjsUpdate`.
   */
  get contentFrames(): Uint8Array[] {
    return this.frames.filter((frame) => frame[0] === 0 && (frame[1] === 1 || frame[1] === 2));
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      // Already gone.
    }
  }
}