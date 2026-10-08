/**
 * y-websocket wire framing, shared by the BoardRoom Durable Object, the client
 * provider wrapper and the tests.
 *
 * Every WebSocket frame is `[type: varUint, ...body]`:
 *
 * | type | meaning                                        |
 * |------|------------------------------------------------|
 * | 0    | sync (SyncStep1 / SyncStep2 / update)          |
 * | 1    | awareness update, body = varUint8Array(update) |
 * | 3    | query awareness                                |
 *
 * Sync bodies are the `y-protocols/sync` messages, i.e. the sync message type
 * (0 = SyncStep1, 1 = SyncStep2, 2 = update) followed by a varUint length
 * prefix and that many payload bytes.
 */

import { createDecoder, readUint8Array, readVarUint } from 'lib0/decoding'
import { createEncoder, toUint8Array, writeVarUint, writeVarUint8Array } from 'lib0/encoding'

export const MESSAGE_SYNC = 0
export const MESSAGE_AWARENESS = 1
export const MESSAGE_QUERY_AWARENESS = 3

/** WebSocket close code used for non-binary / undecodable / invalid traffic. */
export const CLOSE_UNSUPPORTED_DATA = 1003

/** Sync sub-message types (second byte of a sync frame). */
export const SYNC_STEP1 = 0
export const SYNC_STEP2 = 1
export const SYNC_UPDATE = 2

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string }

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** True when the payload is `[...skip varUints, len: varUint, len bytes]` exactly. */
function hasExactPayload(payload: Uint8Array, skip: number): boolean {
  try {
    const decoder = createDecoder(payload)
    for (let i = 0; i < skip; i++) readVarUint(decoder)
    const length = readVarUint(decoder)
    const body = readUint8Array(decoder, length)
    return body.byteLength === length && decoder.pos === payload.byteLength
  } catch {
    return false
  }
}

/**
 * Classify one incoming frame.
 *
 * `payload` is:
 * - sync: the frame *without* the leading type byte, ready for
 *   `readSyncMessage` (which reads the sync message type itself);
 * - awareness: the *complete* frame, because awareness bytes are relayed
 *   verbatim and receivers re-read the type byte;
 * - query-awareness: nothing to relay or apply.
 *
 * Anything else (text frame, unknown type, truncated or undecodable bytes)
 * comes back as `{ kind: 'invalid' }` so the caller can close the socket.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frame is not supported' }
  }
  if (data.byteLength === 0) {
    return { kind: 'invalid', reason: 'empty message' }
  }
  const frame = new Uint8Array(data)
  const type = frame[0]
  switch (type) {
    case MESSAGE_SYNC: {
      const payload = frame.subarray(1)
      if (payload.byteLength === 0) {
        return { kind: 'invalid', reason: 'sync message is truncated' }
      }
      let syncType: number
      try {
        const decoder = createDecoder(payload)
        syncType = readVarUint(decoder)
      } catch (error) {
        return { kind: 'invalid', reason: `unreadable sync message: ${reasonOf(error)}` }
      }
      if (syncType !== SYNC_STEP1 && syncType !== SYNC_STEP2 && syncType !== SYNC_UPDATE) {
        return { kind: 'invalid', reason: `unknown sync message type ${syncType}` }
      }
      if (!hasExactPayload(payload, 1)) {
        return { kind: 'invalid', reason: 'sync message is truncated' }
      }
      return { kind: 'sync', payload }
    }
    case MESSAGE_AWARENESS: {
      const payload = frame.subarray(1)
      if (payload.byteLength === 0) {
        return { kind: 'invalid', reason: 'awareness message is truncated' }
      }
      if (!hasExactPayload(payload, 0)) {
        return { kind: 'invalid', reason: 'awareness message is truncated' }
      }
      return { kind: 'awareness', payload: frame }
    }
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' }
    default:
      return { kind: 'invalid', reason: `unknown message type ${type}` }
  }
}

/** Wrap a payload in the y-websocket framing (`[type, varUint(len), ...payload]`). */
export function encodeFrame(type: number, payload: Uint8Array): Uint8Array {
  const encoder = createEncoder()
  writeVarUint(encoder, type)
  writeVarUint8Array(encoder, payload)
  return toUint8Array(encoder)
}

/** Close code for a board that could not be loaded (persist.load_failure). */
export const CLOSE_BOARD_LOAD_FAILED = 4500

/** Close code for a storage failure: the change was not saved (persist.save_failure). */
export const CLOSE_STORAGE_FAILURE = 1011
