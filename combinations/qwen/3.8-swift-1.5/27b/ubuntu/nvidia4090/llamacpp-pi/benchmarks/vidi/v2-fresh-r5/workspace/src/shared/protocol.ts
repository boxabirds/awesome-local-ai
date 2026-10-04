/**
 * y-websocket wire protocol shared by the Worker, the client provider and the
 * tests.
 *
 * Frame layout (lib0 varuint-prefixed):
 * - SYNC:          [0: varuint][raw y-protocols sync message]
 *   (the sync message is NOT length-prefixed — it is the rest of the frame)
 * - AWARENESS:     [1: varuint][clientID: varuint][state: varuint8array]
 * - QUERY_AWARENESS: [3: varuint]
 */
import * as decoding from 'lib0/decoding';

/** Frame type: Yjs sync protocol message (payload: raw sync message). */
export const MESSAGE_SYNC = 0;
/** Frame type: awareness update (payload: clientID + encoded state). */
export const MESSAGE_AWARENESS = 1;
/** Frame type: request for awareness state (no payload). */
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code for unsupported/undecodable data. */
export const CLOSE_UNSUPPORTED_DATA = 1003;
/**
 * WebSocket close code: the board's saved state could not be loaded.
 * In the 4500–4599 "try again later" range so y-websocket clients keep
 * retrying with backoff until the board loads.
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;
/** WebSocket close code: the room's storage failed; the room was reset. */
export const CLOSE_STORAGE_FAILURE = 1011;

/** Result of decoding one wire frame. */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/** y-protocols sync submessage types. */
const SYNC_SUBMESSAGE_STEP1 = 0;
const SYNC_SUBMESSAGE_STEP2 = 1;
const SYNC_SUBMESSAGE_UPDATE = 2;

/**
 * Decode one y-websocket wire frame. Never throws: any string frame,
 * truncated bytes, unknown type or structurally broken payload yields
 * `{ kind: 'invalid' }`.
 *
 * The sync/awareness payloads are validated structurally (submessage type +
 * varuint8array bounds) so truncated frames are caught here; a Yjs update
 * that is structurally fine but semantically bad is rejected later by
 * `applyUpdate` in the room.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame' };
  }
  try {
    const bytes = new Uint8Array(data);
    if (bytes.length === 0) {
      return { kind: 'invalid', reason: 'empty frame' };
    }
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        const payload = bytes.subarray(decoder.pos);
        if (payload.length === 0) {
          return { kind: 'invalid', reason: 'empty sync payload' };
        }
        // [submessage type: varuint][varuint8array] must fit in the frame.
        const sub = decoding.createDecoder(payload);
        const subType = decoding.readVarUint(sub);
        if (
          subType !== SYNC_SUBMESSAGE_STEP1 &&
          subType !== SYNC_SUBMESSAGE_STEP2 &&
          subType !== SYNC_SUBMESSAGE_UPDATE
        ) {
          return { kind: 'invalid', reason: `unknown sync submessage type ${subType}` };
        }
        const length = decoding.readVarUint(sub);
        if (sub.pos + length > payload.length) {
          return { kind: 'invalid', reason: 'truncated sync payload' };
        }
        return { kind: 'sync', payload: payload.slice() };
      }
      case MESSAGE_AWARENESS: {
        const payload = bytes.subarray(decoder.pos);
        if (payload.length === 0) {
          return { kind: 'invalid', reason: 'empty awareness payload' };
        }
        // [clientID: varuint][state: varuint8array] must fit in the frame.
        const sub = decoding.createDecoder(payload);
        decoding.readVarUint(sub);
        const length = decoding.readVarUint(sub);
        if (sub.pos + length > payload.length) {
          return { kind: 'invalid', reason: 'truncated awareness payload' };
        }
        return { kind: 'awareness', payload: payload.slice() };
      }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (err) {
    return { kind: 'invalid', reason: err instanceof Error ? err.message : String(err) };
  }
}
