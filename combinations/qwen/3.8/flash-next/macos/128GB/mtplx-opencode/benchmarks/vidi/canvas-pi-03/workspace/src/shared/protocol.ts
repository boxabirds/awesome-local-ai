// Wire framing shared by the BoardRoom Durable Object, the integration test
// clients and the browser provider (they all speak the y-websocket framing).
//
// Frame layout (one WebSocket message = one frame):
//
//   [channel]            channel 0 = sync, 1 = awareness, 3 = query-awareness
//   sync:  [0][syncType][contentLength varUint][content bytes]
//   awareness: [1][contentLength varUint][awareness bytes]
//   query-awareness: [3]
//
// `contentLength` is written by lib0's `writeVarUint8Array`, so a well-formed
// frame has a length prefix followed by exactly that many bytes. A frame whose
// declared content length does not match the remaining bytes was truncated or
// corrupted in transit and is treated as invalid.

/** Channel byte: Yjs sync protocol (step1 / step2 / update). */
export const MESSAGE_SYNC = 0;
/** Channel byte: awareness update. */
export const MESSAGE_AWARENESS = 1;
/** Channel byte: awareness query (ignored by the room in this story). */
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code used for non-binary or undecodable traffic. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/** Sync sub-types (y-protocols/sync). */
export const SYNC_STEP1 = 0;
export const SYNC_STEP2 = 1;
export const SYNC_UPDATE = 2;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

function invalid(reason: string): Decoded {
  return { kind: 'invalid', reason };
}

/** Read a lib0 varUint starting at `pos`. Returns the value and the position
 * after it, or null when the varUint runs past the end of the buffer. */
function readVarUint(buf: Uint8Array, start: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  let pos = start;
  for (;;) {
    if (pos >= buf.length) return null;
    const byte = buf[pos];
    pos += 1;
    value += (byte & 0x7f) * Math.pow(2, shift);
    if ((byte & 0x80) === 0) return { value, next: pos };
    shift += 7;
  }
}

/**
 * Decode one incoming WebSocket message into a tagged result. Text frames,
 * empty frames, unknown channel bytes, unknown sync sub-types and any frame
 * whose length prefix disagrees with its content decode as
 * `{ kind: 'invalid' }` (the room closes such sockets with
 * CLOSE_UNSUPPORTED_DATA).
 *
 * `payload` is the frame content after the channel byte, exactly as
 * `y-protocols` consumes it (`readSyncMessage` expects the sync sub-type
 * first; awareness payloads start with the content-length prefix).
 */
export function decodeMessage(data: ArrayBuffer | Uint8Array | string): Decoded {
  if (typeof data === 'string') return invalid('text frames are not supported');
  const frame = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (frame.byteLength === 0) return invalid('empty frame');

  const channel = frame[0];
  const rest = frame.subarray(1);

  switch (channel) {
    case MESSAGE_SYNC: {
      if (rest.length === 0) return invalid('truncated sync message');
      const syncType = rest[0];
      if (syncType !== SYNC_STEP1 && syncType !== SYNC_STEP2 && syncType !== SYNC_UPDATE) {
        return invalid(`unknown sync message type ${syncType}`);
      }
      const length = readVarUint(rest, 1);
      if (length === null) return invalid('truncated sync message');
      // The declared content length must consume exactly the remaining bytes.
      if (length.next + length.value !== rest.length) return invalid('truncated sync message');
      return { kind: 'sync', payload: rest.slice() };
    }
    case MESSAGE_AWARENESS: {
      const length = readVarUint(rest, 0);
      if (length === null) return invalid('truncated awareness message');
      if (length.next + length.value !== rest.length) return invalid('truncated awareness message');
      return { kind: 'awareness', payload: rest.slice() };
    }
    case MESSAGE_QUERY_AWARENESS:
      if (rest.length !== 0) return invalid('unexpected bytes after query-awareness');
      return { kind: 'query-awareness' };
    default:
      return invalid(`unknown message type ${channel}`);
  }
}