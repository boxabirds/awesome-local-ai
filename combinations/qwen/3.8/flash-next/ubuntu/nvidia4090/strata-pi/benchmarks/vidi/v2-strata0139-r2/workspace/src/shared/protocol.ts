/**
 * The y-websocket wire format (`sync.room`'s input contract).
 *
 * Every message on `/api/rooms/:boardId` is a binary WebSocket frame:
 *
 *   varuint(messageType) followed by the message body.
 *
 * Type 0 is a `y-protocols/sync` message, type 1 an awareness update, type 3 a
 * query for everyone's awareness state. The room never interprets the sync body
 * itself — `decodeMessage` only checks that the frame is *shaped* like a
 * message the room can hand to `y-protocols`, and returns the body verbatim so
 * the room can decode it a second time with the real protocol reader. Anything
 * else (a text frame, a truncated frame, an unknown type) is `invalid`, and the
 * room closes that one socket with 1003.
 */

import { createDecoder, readVarUint } from "lib0/decoding";

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code for a frame the room cannot understand. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/** `y-protocols/sync` message types, in the order they appear in a sync body. */
const SYNC_STEP_1 = 0;
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;

export type Decoded =
  | { kind: "sync"; payload: Uint8Array }
  | { kind: "awareness"; payload: Uint8Array }
  | { kind: "query-awareness" }
  | { kind: "invalid"; reason: string };

/**
 * Decodes one WebSocket frame.
 *
 * `payload` is the message body — everything after the message-type varuint —
 * copied out of the frame, so the caller can decode it independently.
 */
export function decodeMessage(data: ArrayBuffer | Uint8Array | string): Decoded {
  // Binary protocol: a text frame is never board traffic.
  if (typeof data === "string") return { kind: "invalid", reason: "text frames are not supported" };

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength === 0) return { kind: "invalid", reason: "empty frame" };

  try {
    const decoder = createDecoder(bytes);
    const type = readVarUint(decoder);

    switch (type) {
      case MESSAGE_SYNC: {
        const bodyStart = decoder.pos;
        const syncType = readVarUint(decoder);
        if (syncType !== SYNC_STEP_1 && syncType !== SYNC_STEP_2 && syncType !== SYNC_UPDATE) {
          return { kind: "invalid", reason: `unknown sync message type ${syncType}` };
        }
        // Every sync body is `varuint(type) + varuint8array(payload)`; lib0
        // would silently shorten a payload that runs past the end of the frame,
        // so the declared length is checked here.
        const payloadLength = readVarUint(decoder);
        if (decoder.pos + payloadLength > bytes.byteLength) {
          return { kind: "invalid", reason: "truncated sync message" };
        }
        decoder.pos += payloadLength;
        if (decoder.pos !== bytes.byteLength) {
          return { kind: "invalid", reason: "trailing bytes after sync message" };
        }
        return { kind: "sync", payload: bytes.slice(bodyStart, bytes.byteLength) };
      }

      case MESSAGE_AWARENESS: {
        const bodyStart = decoder.pos;
        const payloadLength = readVarUint(decoder);
        if (decoder.pos + payloadLength > bytes.byteLength) {
          return { kind: "invalid", reason: "truncated awareness message" };
        }
        decoder.pos += payloadLength;
        if (decoder.pos !== bytes.byteLength) {
          return { kind: "invalid", reason: "trailing bytes after awareness message" };
        }
        return { kind: "awareness", payload: bytes.slice(bodyStart, bytes.byteLength) };
      }

      case MESSAGE_QUERY_AWARENESS:
        if (decoder.pos !== bytes.byteLength) {
          return { kind: "invalid", reason: "trailing bytes after query-awareness message" };
        }
        return { kind: "query-awareness" };

      default:
        return { kind: "invalid", reason: `unknown message type ${type}` };
    }
  } catch (error) {
    return {
      kind: "invalid",
      reason: error instanceof Error ? error.message : "undecodable frame",
    };
  }
}
