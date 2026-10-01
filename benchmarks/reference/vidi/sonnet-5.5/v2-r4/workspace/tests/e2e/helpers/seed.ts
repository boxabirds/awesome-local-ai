import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { MESSAGE_SYNC } from '../../../src/shared/protocol';

/**
 * Writes a whole doc to a board through a real WebSocket (Node's global WebSocket) and resolves once the
 * server has answered a later SyncStep1, i.e. after it has processed the state sent before it.
 */
export async function seedBoard(baseUrl: string, boardId: string, source: Y.Doc): Promise<void> {
  const ws = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/api/rooms/${boardId}`);
  ws.binaryType = 'arraybuffer';
  const scratch = new Y.Doc();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('seed timed out')), 30_000);
    let step1Sent = false;
    ws.onerror = () => reject(new Error('seed socket error'));
    ws.onclose = (e) => reject(new Error(`seed socket closed ${e.code}`));
    ws.onmessage = (ev) => {
      const decoder = decoding.createDecoder(new Uint8Array(ev.data as ArrayBuffer));
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      const type = syncProtocol.readSyncMessage(decoder, reply, scratch, 'server');
      if (encoding.length(reply) > 1) ws.send(encoding.toUint8Array(reply));
      if (type === syncProtocol.messageYjsSyncStep1 && !step1Sent) {
        step1Sent = true;
        // Everything the server lacks, then a barrier: its answer to this SyncStep1 proves the state was applied.
        const state = encoding.createEncoder();
        encoding.writeVarUint(state, MESSAGE_SYNC);
        syncProtocol.writeUpdate(state, Y.encodeStateAsUpdate(source));
        ws.send(encoding.toUint8Array(state));
        const barrier = encoding.createEncoder();
        encoding.writeVarUint(barrier, MESSAGE_SYNC);
        syncProtocol.writeSyncStep1(barrier, new Y.Doc());
        ws.send(encoding.toUint8Array(barrier));
      } else if (type === syncProtocol.messageYjsSyncStep2 && step1Sent) {
        clearTimeout(timer);
        resolve();
      }
    };
  });
  ws.onclose = null;
  ws.close();
}
