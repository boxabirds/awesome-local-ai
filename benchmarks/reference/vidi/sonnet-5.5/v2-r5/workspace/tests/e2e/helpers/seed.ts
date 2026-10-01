import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { MESSAGE_SYNC } from '../../../src/shared/protocol';

const REMOTE = Symbol('remote');

/**
 * Seeds a board over a real WebSocket exactly like a browser would (y-websocket framing), without a browser.
 * Resolves once the server has answered a SyncStep1 sent after the last update, i.e. has processed everything.
 */
export async function seedBoard(baseURL: string, boardId: string, build: (doc: Y.Doc) => void): Promise<void> {
  const url = `${baseURL.replace(/^http/, 'ws')}/api/rooms/${boardId}`;
  const doc = new Y.Doc();
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  let step2Count = 0;
  const waiters: Array<() => void> = [];

  ws.addEventListener('message', (ev) => {
    const decoder = decoding.createDecoder(new Uint8Array(ev.data as ArrayBuffer));
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    const kind = syncProtocol.readSyncMessage(decoder, enc, doc, REMOTE);
    if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
    if (kind === syncProtocol.messageYjsSyncStep2) {
      step2Count += 1;
      waiters.splice(0).forEach((w) => w());
    }
  });
  const nextStep2 = (): Promise<void> => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('seed: no SyncStep2 from server')), 30_000);
    waiters.push(() => { clearTimeout(t); resolve(); });
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error(`seed: cannot open ${url}`)));
  });

  const step1 = (): void => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, doc);
    ws.send(encoding.toUint8Array(enc));
  };
  const first = nextStep2();
  step1();
  await first;

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    ws.send(encoding.toUint8Array(enc));
  });
  build(doc);

  const before = step2Count;
  const confirmed = nextStep2();
  step1();
  await confirmed;
  if (step2Count <= before) throw new Error('seed: not confirmed');
  ws.close(1000);
}
