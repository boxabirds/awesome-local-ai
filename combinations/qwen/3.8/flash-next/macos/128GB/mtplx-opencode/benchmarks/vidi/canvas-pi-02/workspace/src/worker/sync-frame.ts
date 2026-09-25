/**
 * The two frames a room *sends* back for a sync message (story 4).
 *
 * Reading a frame is `../shared/protocol`'s job — `decodeMessage` already knows
 * the wire, and a second reader here would be a second opinion about the same
 * bytes. Writing is a separate concern because the answer has to be built in the
 * shape the *client* reads, not the shape the room read.
 *
 * A client's `readMessage` pops the message type, hands the rest to
 * `readSyncMessage`, and that function reads a sync sub-type and then one
 * length-prefixed body — strictly. `readVarUint8Array` throws when the declared
 * length and the bytes that follow disagree, and a thrown read inside
 * `handleMessage` closes the connection. So these builders write the whole
 * frame, prefix included, rather than returning a body the caller would have to
 * frame by hand: the off-by-one-byte class of bug lives exactly where the two
 * halves get joined.
 */

import { encode, writeVarUint, writeVarUint8Array } from 'lib0/encoding';

import { MESSAGE_SYNC, SYNC_STEP_ONE, SYNC_STEP_TWO, SYNC_UPDATE } from '../shared/protocol';

/**
 * `[0, 0, length, vector]` — the shape a client's `readSyncStep1` reads.
 *
 * An empty vector means "send me everything", which is what a rejoin after a
 * restart asks, and it is still framed: `[0, 0, 0]`, not a bare `[0, 0]`.
 */
export function syncStep1Message(vector: Uint8Array): Uint8Array {
  return encode((encoder) => {
    writeVarUint(encoder, MESSAGE_SYNC);
    writeVarUint(encoder, SYNC_STEP_ONE);
    writeVarUint8Array(encoder, vector);
  });
}

/** `[0, 1, length, update]` — the shape a client's `readSyncStep2` reads. */
export function syncStep2Message(update: Uint8Array): Uint8Array {
  return encode((encoder) => {
    writeVarUint(encoder, MESSAGE_SYNC);
    writeVarUint(encoder, SYNC_STEP_TWO);
    writeVarUint8Array(encoder, update);
  });
}

/**
 * `[0, 2, length, update]` — the shape a relayed document change takes.
 *
 * A relay rebuilds the frame rather than forwarding the bytes it read, for the
 * reason `frameShape` documents: the room's answer to "what is this frame?" is
 * a *content* decision, and the shape on the wire is the room's own. It also
 * keeps a client's own auto-reply from being bounced back at it.
 */
export function syncUpdateMessage(update: Uint8Array): Uint8Array {
  return encode((encoder) => {
    writeVarUint(encoder, MESSAGE_SYNC);
    writeVarUint(encoder, SYNC_UPDATE);
    writeVarUint8Array(encoder, update);
  });
}

/**
 * The sync sub-type and the bytes inside a frame that `decodeMessage` already
 * validated, read back out.
 *
 * This is not a second gate: the payload arrived from `decodeMessage`, which
 * checked that the length prefix reaches exactly the end of the frame, so the
 * only work here is to say *which* sync message it was — the question and the
 * two kinds of content that `y-protocols/sync` writes back-to-back — and to hand
 * over the bytes to apply. `null` means the frame was not a sync frame at all.
 */export function syncBody(payload: Uint8Array): { step: number; bytes: Uint8Array } | null {
  const step = payload[0];
  if (step === undefined) return null;

  // Skip the varUint length prefix that sits between the sub-type and the bytes.
  let index = 1;
  while (index < payload.length && (payload[index]! & 0x80) !== 0) index += 1;
  if (index >= payload.length) return null;
  return { step, bytes: payload.subarray(index + 1) };
}
