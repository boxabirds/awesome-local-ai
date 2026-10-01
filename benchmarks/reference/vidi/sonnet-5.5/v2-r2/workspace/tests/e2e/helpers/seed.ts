import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

const frame = (write: (e: encoding.Encoder) => void): Uint8Array => {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, 0);
  write(e);
  return encoding.toUint8Array(e);
};

/**
 * Seeds a board over a real WebSocket: pushes `doc`'s state to the room and waits until the
 * room has answered a later SyncStep1, which proves the update was applied and stored.
 */
export async function seedBoard(baseUrl: string, boardId: string, doc: Y.Doc): Promise<void> {
  const remote = new Y.Doc();
  const ws = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/api/rooms/${boardId}`);
  ws.binaryType = 'arraybuffer';
  await new Promise<void>((resolve, reject) => {
    let pushed = false;
    ws.onerror = () => reject(new Error('seed socket error'));
    ws.onclose = (e) => reject(new Error(`seed socket closed ${e.code}`));
    ws.onmessage = (e) => {
      const decoder = decoding.createDecoder(new Uint8Array(e.data as ArrayBuffer));
      if (decoding.readVarUint(decoder) !== 0) return;
      const syncType = decoding.peekVarUint(decoder);
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, 0);
      syncProtocol.readSyncMessage(decoder, reply, remote, 'seed');
      if (encoding.length(reply) > 1) ws.send(encoding.toUint8Array(reply) as BufferSource);
      if (syncType === syncProtocol.messageYjsSyncStep2) {
        if (!pushed) {
          pushed = true;
          ws.send(frame((enc) => syncProtocol.writeUpdate(enc, Y.encodeStateAsUpdate(doc))) as BufferSource);
          ws.send(frame((enc) => syncProtocol.writeSyncStep1(enc, new Y.Doc())) as BufferSource);
        } else {
          resolve();
        }
      }
    };
    ws.onopen = () => ws.send(frame((enc) => syncProtocol.writeSyncStep1(enc, remote)) as BufferSource);
  });
  ws.onclose = null;
  ws.close();
}

export async function testHook(baseUrl: string, boardId: string, action: 'corrupt-snapshot' | 'repair'): Promise<void> {
  const res = await fetch(`${baseUrl}/__test/boards/${boardId}/${action}`, { method: 'POST' });
  if (res.status !== 204) throw new Error(`hook ${action} failed: ${res.status} ${await res.text()}`);
}
