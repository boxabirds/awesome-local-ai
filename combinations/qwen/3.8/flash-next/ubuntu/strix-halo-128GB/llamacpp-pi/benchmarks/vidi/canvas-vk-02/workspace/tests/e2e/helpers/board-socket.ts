/**
 * tests/e2e/helpers/board-socket.ts
 *
 * A board client that is not a browser.
 *
 * Some things an end-to-end test needs before it can measure anything — a board
 * with two thousand notes on it, say — and doing them through the user interface
 * would be measuring the wrong thing. This is the y-websocket conversation the
 * real client has, spoken from Node with the same `y-protocols` module and the
 * same `shared/protocol` framing the worker uses, against the same room over the
 * same socket. What it writes, the browser then reads, and the only shortcut is
 * that it has no canvas to draw.
 *
 * Two properties matter here beyond convenience: the room stores a change before
 * it broadcasts it, so a second connection being told about a change is proof
 * that the change is on disk; and everything this writes is an ordinary Yjs
 * update, exactly as a client's would be.
 */
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { initDoc, snapshot } from '../../../src/shared/board-model';
import { MESSAGE_SYNC, decodeMessage, frameMessage } from '../../../src/shared/protocol';

/** Origin stamp for changes that came in over the wire, so we never echo them. */
const REMOTE = Symbol('board-socket.remote');

export interface BoardSocket {
  readonly doc: Y.Doc;
  close(): Promise<void>;
}

/**
 * Connect to a board and stay in step with it.
 *
 * The handshake is the one y-websocket rooms expect: both sides ask for what the
 * other has as soon as the socket opens, and each answers with the part of its
 * document the other does not know.
 */
export async function openBoardSocket(url: string): Promise<BoardSocket> {
  const doc = new Y.Doc();
  initDoc(doc);

  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error(`could not reach ${url}`)), { once: true });
  });

  // A copy over an ArrayBuffer: what a socket sends is bytes, and the encoders
  // hand back views that the DOM socket's own types do not accept.
  const send = (bytes: Uint8Array): void => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(bytes.slice().buffer as ArrayBuffer);
  };

  // Ours to send: everything the local board knows that the room does not.
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return;
    if (process.env.VIDI_DEBUG) console.log(`send update ${String(update.byteLength)} bytes`);
    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    send(frameMessage(MESSAGE_SYNC, encoding.toUint8Array(encoder)));
  });
  socket.addEventListener('close', (event: CloseEvent) => {
    if (process.env.VIDI_DEBUG) console.log(`closed ${String(event.code)} ${event.reason}`);
  });
  socket.addEventListener('error', () => {
    if (process.env.VIDI_DEBUG) console.log('socket error');
  });

  socket.addEventListener('message', (event: MessageEvent) => {
    const decoded = decodeMessage(event.data as ArrayBuffer);
    if (decoded.kind !== 'sync') return;
    const encoder = encoding.createEncoder();
    // The origin is stamped on the incoming changes, so the listener above can
    // tell a change we are being told about from one this socket is making.
    syncProtocol.readSyncMessage(
      decoding.createDecoder(decoded.payload),
      encoder,
      doc,
      REMOTE,
      (error) => console.warn(`board socket: ${String(error)}`),
    );
    // The reply has to be framed like everything else: the sync body the
    // protocols library writes is only the inside of a y-websocket message, and
    // a bare body on the wire is somebody else's protocol error.
    const body = encoding.toUint8Array(encoder);
    if (body.byteLength > 0) send(frameMessage(MESSAGE_SYNC, body));
  });

  // Ask for the board.
  const encoder = encoding.createEncoder();
  syncProtocol.writeSyncStep1(encoder, doc);
  send(frameMessage(MESSAGE_SYNC, encoding.toUint8Array(encoder)));

  return {
    doc,
    close: async () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        await new Promise<void>((resolve) => {
          socket.addEventListener('close', () => resolve(), { once: true });
          socket.close(1000, '');
          setTimeout(resolve, 2_000).unref();
        });
      }
      doc.destroy();
    },
  };
}

/**
 * Put a board on a server and prove the room has it: build it, hang up, then
 * connect again as somebody else and wait for the notes to come back.
 *
 * Waiting on a second connection is the point, not a formality — a room writes
 * before it broadcasts, so notes seen by a newcomer are notes that were written.
 */
export async function seedBoard(url: string, build: (doc: Y.Doc) => void): Promise<void> {
  const author = await openBoardSocket(url);
  try {
    build(author.doc);
    // One transaction per note is what a person does; leave the socket long
    // enough for the last of those updates to be on its way.
    await new Promise((resolve) => setTimeout(resolve, 250));
  } finally {
    await author.close();
  }

  const witness = await openBoardSocket(url);
  try {
    await until(() => snapshot(witness.doc).length, (count) => count > 0);
  } finally {
    await witness.close();
  }
}

/** Poll a board until it says something worth continuing for. */
async function until<T>(probe: () => T, done: (value: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (process.env.VIDI_DEBUG) console.log(`probe: ${String(value)}`);
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error('the board never said what it was holding');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** How many notes a board socket is holding. */
export function noteCount(doc: Y.Doc): number {
  return snapshot(doc).length;
}
