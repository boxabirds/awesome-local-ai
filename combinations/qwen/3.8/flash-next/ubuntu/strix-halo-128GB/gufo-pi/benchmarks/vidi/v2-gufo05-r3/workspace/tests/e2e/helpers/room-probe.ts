/**
 * Join a board from Node over the wire, without a browser (story 4).
 *
 * A browser tab cannot be asked "do you have the board yet?" while it is busy
 * building two thousand positioned elements: the answer arrives after the work, so
 * the number looks like rendering. This probe speaks the same sync protocol the
 * client does and measures only what the room costs — reading its storage and
 * handing the board over.
 */
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';

import { decodeMessage, MESSAGE_SYNC } from '../../../src/shared/protocol';

export interface Handover {
  /** Milliseconds from opening the socket to holding the whole board. */
  readonly ms: number;
  /** How many board objects arrived. */
  readonly objects: number;
}

/** Fetch the whole board as a wire client would, and time it. */
export async function timeBoardHandover(
  origin: string,
  boardId: string,
  expectedObjects: number,
  timeoutMs = 120_000,
): Promise<Handover> {
  const doc = new Y.Doc();
  const url = `${origin.replace(/^http/, 'ws')}/api/rooms/${boardId}`;
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  const started = Date.now();

  socket.addEventListener('message', (event) => {
    const decoded = decodeMessage(event.data as ArrayBuffer);
    if (decoded.kind !== 'sync') return;
    const encoder = encoding.createEncoder();
    syncProtocol.readSyncMessage(decoding.createDecoder(decoded.payload), encoder, doc, socket);
    if (encoding.length(encoder) > 1) socket.send(encoding.toUint8Array(encoder));
  });

  try {
    await new Promise<void>((resolveOpen, rejectOpen) => {
      socket.addEventListener('open', () => resolveOpen(), { once: true });
      socket.addEventListener('error', () => rejectOpen(new Error('the room refused the socket')), {
        once: true,
      });
    });

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    socket.send(encoding.toUint8Array(encoder));

    const deadline = Date.now() + timeoutMs;
    let objects = doc.getMap('objects').size;
    while (objects < expectedObjects) {
      if (socket.readyState >= WebSocket.CLOSED) {
        throw new Error(`the socket went away holding ${objects} objects`);
      }
      if (Date.now() > deadline) {
        throw new Error(`only ${objects} of ${expectedObjects} objects arrived in time`);
      }
      await new Promise((resolveTick) => setTimeout(resolveTick, 20));
      objects = doc.getMap('objects').size;
    }
    return { ms: Date.now() - started, objects };
  } finally {
    socket.close();
  }
}
