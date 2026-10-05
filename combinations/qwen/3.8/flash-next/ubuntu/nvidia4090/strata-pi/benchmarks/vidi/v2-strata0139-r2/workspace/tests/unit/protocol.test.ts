import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from "../../src/shared/protocol";

/**
 * TC-03 — `sync.room` message decoding.
 *
 * The frames below are built with the same encoders the browser provider uses,
 * so the room is tested against the wire format it will really see: a leading
 * message-type varuint followed by that protocol's own body.
 */

function frame(type: number, write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

function syncStep1Frame(doc: Y.Doc): Uint8Array {
  return frame(MESSAGE_SYNC, (encoder) => syncProtocol.writeSyncStep1(encoder, doc));
}

function syncUpdateFrame(update: Uint8Array): Uint8Array {
  return frame(MESSAGE_SYNC, (encoder) => syncProtocol.writeUpdate(encoder, update));
}

function awarenessFrame(awareness: awarenessProtocol.Awareness): Uint8Array {
  return frame(MESSAGE_AWARENESS, (encoder) =>
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.doc.clientID]),
    ),
  );
}

/** The body of a frame: everything after the one-byte message-type varuint. */
function bodyOf(frameBytes: Uint8Array): Uint8Array {
  const decoder = decoding.createDecoder(frameBytes);
  decoding.readVarUint(decoder);
  return frameBytes.slice(decoder.pos);
}

describe("decodeMessage (TC-03)", () => {
  const doc = new Y.Doc();
  doc.getMap<Y.Map<unknown>>("objects").set("a", new Y.Map());
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState({ id: doc.clientID });
  const update = Y.encodeStateAsUpdate(doc);

  it("types the protocol constants used by y-websocket framing", () => {
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });

  it("decodes a SyncStep1 frame as sync, with the body verbatim", () => {
    const bytes = syncStep1Frame(doc);
    const buffer = new ArrayBuffer(bytes.length);
    new Uint8Array(buffer).set(bytes);
    const decoded = decodeMessage(buffer);
    expect(decoded.kind).toBe("sync");
    if (decoded.kind === "sync") {
      expect(Array.from(decoded.payload)).toEqual(Array.from(bodyOf(bytes)));
    }
  });

  it("decodes a document-update frame as sync", () => {
    const decoded = decodeMessage(syncUpdateFrame(update));
    expect(decoded.kind).toBe("sync");
  });

  it("decodes an awareness frame as awareness, with the body verbatim", () => {
    const bytes = awarenessFrame(awareness);
    const decoded = decodeMessage(bytes);
    expect(decoded.kind).toBe("awareness");
    if (decoded.kind === "awareness") {
      expect(Array.from(decoded.payload)).toEqual(Array.from(bodyOf(bytes)));
    }
  });

  it("decodes a query-awareness frame (no payload)", () => {
    const decoded = decodeMessage(
      frame(MESSAGE_QUERY_AWARENESS, () => undefined),
    );
    expect(decoded).toEqual({ kind: "query-awareness" });
  });

  it("rejects an unknown message type (9)", () => {
    const decoded = decodeMessage(frame(9, (encoder) => encoding.writeVarUint8Array(encoder, update)));
    expect(decoded.kind).toBe("invalid");
  });

  it("rejects a frame that is only a message type (truncated sync body)", () => {
    expect(decodeMessage(new Uint8Array([MESSAGE_SYNC])).kind).toBe("invalid");
  });

  it("rejects a document-update frame cut short (truncated payload)", () => {
    const bytes = syncUpdateFrame(update);
    expect(decodeMessage(bytes.slice(0, bytes.length - 3)).kind).toBe("invalid");
  });

  it("rejects an awareness frame cut short (truncated payload)", () => {
    const bytes = awarenessFrame(awareness);
    expect(decodeMessage(bytes.slice(0, bytes.length - 2)).kind).toBe("invalid");
  });

  it("rejects an empty frame", () => {
    expect(decodeMessage(new Uint8Array([])).kind).toBe("invalid");
  });

  it("rejects a text frame (strings are not board traffic)", () => {
    const decoded = decodeMessage("hello");
    expect(decoded.kind).toBe("invalid");
  });

  it("reports a reason for every invalid frame", () => {
    for (const data of ["hello", new Uint8Array([]), new Uint8Array([9, 1, 2, 3])]) {
      const decoded = decodeMessage(data);
      expect(decoded.kind).toBe("invalid");
      if (decoded.kind === "invalid") expect(decoded.reason.length).toBeGreaterThan(0);
    }
  });
});
