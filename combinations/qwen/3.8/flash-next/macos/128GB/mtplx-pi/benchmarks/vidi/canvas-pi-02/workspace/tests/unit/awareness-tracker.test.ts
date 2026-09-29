import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { decodeMessage } from '../../src/shared/protocol';
import {
  clientsFromAttachment,
  encodeAwarenessRemoval,
  mergeTracked,
  readAwarenessClients,
} from '../../src/worker/awareness-tracker';

/**
 * Story 6, task 7: the pure half of `presence.room_tracking` (TC-01 to TC-03).
 *
 * The fixtures here are made by real `Awareness` instances, not by hand-written
 * bytes, for the same reason story 3 built its sync frames with lib0: a tracker
 * that only understands a fixture the test also wrote proves nothing about the
 * wire. The hand-built bytes are kept for the *broken* cases, where the whole
 * point is a shape no correct client would send.
 */

/**
 * One awareness instance with a *fixed* numeric client id.
 *
 * The id is a number, not a label: awareness writes it as a varUint, and the
 * test would otherwise be encoding a string where the protocol wants an
 * integer. Fixed values keep a failure reproducible.
 */
function makeAwareness(clientId: number): awarenessProtocol.Awareness {
  const doc = new Y.Doc();
  doc.clientID = clientId;
  return new awarenessProtocol.Awareness(doc);
}

/** A realistic presence state, in the shape the client publishes. */
const STATE_A = {
  user: { id: 'g_AAAAAAAAAAAAAAAA', name: 'Brave Heron', color: '#1E88E5' },
  cursor: { x: 120.5, y: -40 },
  selection: ['018f6c2a-1111-4111-8111-111111111111'],
};

const STATE_B = {
  user: { id: 'g_BBBBBBBBBBBBBBBB', name: 'Curious Otter', color: '#43A047' },
  cursor: { x: -4000, y: 900 },
  selection: [],
};

describe('readAwarenessClients (TC-01)', () => {
  it('reads the client ids and clocks of a real two-client update', () => {
    const first = makeAwareness(698_710_089);
    const second = makeAwareness(2_983_377_874);
    first.setLocalState(STATE_A);
    second.setLocalState(STATE_B);

    // Both states collected into one awareness, then re-encoded: this is the
    // shape a relay produces when two people's presence arrives in one frame.
    const sink = makeAwareness(12345);
    awarenessProtocol.applyAwarenessUpdate(sink, awarenessProtocol.encodeAwarenessUpdate(first, [first.clientID]), 'test');
    awarenessProtocol.applyAwarenessUpdate(sink, awarenessProtocol.encodeAwarenessUpdate(second, [second.clientID]), 'test');
    const update = awarenessProtocol.encodeAwarenessUpdate(sink, [...sink.states.keys()]);

    const read = readAwarenessClients(update);
    expect(read).not.toBeNull();
    const asRecord = Object.fromEntries(read!);
    expect(asRecord[first.clientID]).toBe(sink.meta.get(first.clientID)!.clock);
    expect(asRecord[second.clientID]).toBe(sink.meta.get(second.clientID)!.clock);
    // Three entries, not two: a `Awareness` carries its own (empty) state too,
    // which is what the query answer in TC-06 looks like on the wire. Reading
    // *two* here would mean the tracker quietly disagreed with the protocol
    // about what the frame contained.
    expect(read!.size).toBe(3);
    expect(asRecord[sink.clientID]).toBe(0);

    for (const awareness of [first, second, sink]) awareness.destroy();
  });

  it('reads a 32-bit client id, because ids are not small numbers', () => {
    // Yjs ids are 32-bit, so the varUint is five bytes long. A reader that
    // only works for small ids would pass every test that happens to use a
    // small id, and then mis-track a real person.
    const bytes = Uint8Array.from([
      0x01, // count = 1
      0xd2, 0xf7, 0xca, 0x8e, 0x0b, // 2_983_377_874
      0x01, // clock = 1
      0x02, 0x7b, 0x7d, // "{}"
    ]);
    expect(readAwarenessClients(bytes)).toEqual(new Map([[2_983_377_874, 1]]));
  });

  it('reports a removal as no live clients, not as garbage', () => {
    const awareness = makeAwareness(4_000_000_001);
    awareness.setLocalState(STATE_A);
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]);

    // `null` would mean "not awareness traffic" and the room would stop
    // tracking the person; an empty map means "nobody here", which is true.
    expect(readAwarenessClients(update)!.size).toBe(1);
    expect(readAwarenessClients(removalPayload(new Map([[awareness.clientID, 1]]))))
      .toEqual(new Map());

    // The same shape from the other side: a disconnecting y-websocket client
    // sends its own removal, and the room has to read it as "this one is gone"
    // rather than treating the frame as junk and leaving the attachment pointing
    // at a person who is not here.
    awarenessProtocol.removeAwarenessStates(awareness, [awareness.clientID], 'test');
    const farewell = awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]);
    expect(readAwarenessClients(farewell)).toEqual(new Map());
    awareness.destroy();
  });
});

/** Build an awareness update by hand: `[count]([id][clock][json])*`. */
function updateBytes(entries: [number, number, string][]): Uint8Array {
  const putVarUint = (value: number): number[] => {
    const out: number[] = [];
    let rest = value;
    for (;;) {
      const byte = rest & 0x7f;
      rest >>>= 7;
      out.push(rest > 0 ? byte | 0x80 : byte);
      if (rest === 0) return out;
    }
  };
  const bytes: number[] = [...putVarUint(entries.length)];
  for (const [id, clock, json] of entries) {
    // A varString is a byte length, then the bytes - and the length is itself a
    // varUint, which is why a long state does not fit in one byte either.
    const body = [...json].map((character) => character.charCodeAt(0));
    bytes.push(...putVarUint(id), ...putVarUint(clock), ...putVarUint(body.length), ...body);
  }
  return Uint8Array.from(bytes);
}

/**
 * The body of the frame a removal produces.
 *
 * `encodeAwarenessRemoval` returns a whole frame (that is what goes on the wire)
 * and `readAwarenessClients` reads a body (that is what `decodeMessage` hands
 * over), so a test that wants one has to go through the other. Routing that
 * through `decodeMessage` also means a removal whose framing was wrong fails
 * here, instead of quietly looking like a state nobody recognises.
 */
function removalPayload(clients: Map<number, number>): Uint8Array {
  const decoded = decodeMessage(encodeAwarenessRemoval(clients));
  if (decoded.kind !== 'awareness') {
    throw new Error(`removal frame did not decode as awareness: ${JSON.stringify(decoded)}`);
  }
  return decoded.payload;
}

describe('encodeAwarenessRemoval (TC-02)', () => {
  it('removes exactly the clients it names, at the clock they were seen', () => {
    const first = makeAwareness(698_710_089);
    const second = makeAwareness(2_983_377_874);
    first.setLocalState(STATE_A);
    second.setLocalState(STATE_B);

    const viewer = makeAwareness(12345);
    awarenessProtocol.applyAwarenessUpdate(
      viewer,
      awarenessProtocol.encodeAwarenessUpdate(first, [first.clientID]),
      'test',
    );
    awarenessProtocol.applyAwarenessUpdate(
      viewer,
      awarenessProtocol.encodeAwarenessUpdate(second, [second.clientID]),
      'test',
    );
    // Two people plus the viewer's own state.
    expect(viewer.states.size).toBe(3);

    const clocks = new Map([[first.clientID, viewer.meta.get(first.clientID)!.clock]]);
    const removal = removalPayload(clocks);

    const changes: { removed: number[] }[] = [];
    viewer.on('change', (event: { removed: number[] }) => changes.push(event));
    awarenessProtocol.applyAwarenessUpdate(viewer, removal, 'room');

    expect(viewer.states.has(first.clientID)).toBe(false);
    expect(viewer.states.size).toBe(2);
    // The other person is untouched, and that is the whole point of naming ids
    // instead of broadcasting "everybody except me".
    expect(viewer.states.get(second.clientID)).toEqual(STATE_B);
    expect(changes).toEqual([{ added: [], updated: [], removed: [first.clientID] }]);

    for (const awareness of [first, second, viewer]) awareness.destroy();
  });

  it('survives more clients than a fixed buffer would have held', () => {
    // A room tracks one person as a handful of ids, but the encoder must not be
    // the thing that decides what "a handful" is: a write past the end of a
    // typed array is silently dropped, which would produce a frame whose declared
    // count is a lie - and a lie here means ghosts on every other screen.
    const ids: number[] = [];
    for (let id = 0; id < 300; id += 1) ids.push(id * 1000 + 7);

    const viewer = makeAwareness(12345);
    awarenessProtocol.applyAwarenessUpdate(
      viewer,
      updateBytes(ids.map((id) => [id, 1, '{"cursor":null}'])),
      'test',
    );
    // +1 for the viewer's own state, which is never part of the removal.
    expect(viewer.states.size).toBe(ids.length + 1);

    const removal = removalPayload(new Map(ids.map((id) => [id, 1])));
    expect(readAwarenessClients(removal)).toEqual(new Map());
    awarenessProtocol.applyAwarenessUpdate(viewer, removal, 'room');
    expect(viewer.states.size).toBe(1);
    expect(viewer.states.has(12345)).toBe(true);
    viewer.destroy();
  });

  it('frames a long removal so the lengths it declares are the lengths it has', () => {
    // Three hundred entries is over 3 KB, so the length prefix needs two bytes
    // and the frame is longer than any single-byte count could describe. A frame
    // that lies about its own length is not a broken-but-harmless message: the
    // room relays it, the client reads a body that runs off the end and the whole
    // socket closes with 1003, which takes everyone's presence down with it.
    const ids: number[] = [];
    for (let id = 0; id < 300; id += 1) ids.push(id * 1000 + 7);
    const frame = encodeAwarenessRemoval(new Map(ids.map((id) => [id, 1])));
    const decoded = decodeMessage(frame);
    expect(decoded.kind).toBe('awareness');
    // `decodeMessage` only accepts a frame whose declared body length ends it
    // exactly, so being recognised is already half the assertion. The rest: the
    // body really is over 255 bytes and the prefix really is two bytes wide
    // (three header bytes before the count byte of the body).
    expect(frame.byteLength).toBeGreaterThan(255);
    if (decoded.kind !== 'awareness') throw new Error('unreachable');
    expect(decoded.payload.byteLength).toBe(frame.byteLength - 3);
    // 300 does not fit in one byte either: the count is `[0xAC, 0x02]`.
    expect([...decoded.payload.subarray(0, 2)]).toEqual([0xac, 0x02]);
    expect(frame[0]).toBe(1); // the awareness message type

    // And a one-client removal, the case that actually happens, keeps its shape.
    const single = decodeMessage(encodeAwarenessRemoval(new Map([[7, 3]])));
    expect(single).toEqual({ kind: 'awareness', payload: Uint8Array.from([1, 7, 3, 4, 0x6e, 0x75, 0x6c, 0x6c]) });
  });
});

describe('readAwarenessClients errors (TC-03)', () => {
  const broken: [string, Uint8Array][] = [
    ['an empty update', new Uint8Array(0)],
    ['a count of zero', Uint8Array.from([0x00])],
    ['only a count', Uint8Array.from([0x01])],
    ['a truncated entry (no clock)', Uint8Array.from([0x01, 0x07])],
    ['a truncated entry (no state)', Uint8Array.from([0x01, 0x07, 0x01])],
    ['a state length past the end', Uint8Array.from([0x01, 0x07, 0x01, 0x20, 0x7b, 0x7d])],
    ['a state that is not JSON', Uint8Array.from([0x01, 0x07, 0x01, 0x04, 0x6e, 0x6f, 0x6e, 0x65])],
    ['a state that is a bare number', Uint8Array.from([0x01, 0x07, 0x01, 0x01, 0x31])],
    ['a state that is a bare string', Uint8Array.from([0x01, 0x07, 0x01, 0x03, 0x22, 0x78, 0x22])],
    ['a count larger than the entries', Uint8Array.from([0x02, 0x07, 0x01, 0x02, 0x7b, 0x7d])],
    ['a valid entry with trailing bytes', Uint8Array.from([0x01, 0x07, 0x01, 0x02, 0x7b, 0x7d, 0x00])],
    ['an endless varUint', Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff])],
  ];

  it.each(broken)('%s is refused without throwing', (_name, bytes) => {
    expect(() => readAwarenessClients(bytes)).not.toThrow();
    expect(readAwarenessClients(bytes)).toBeNull();
  });

  it('refuses an absurd entry count instead of reading a long time', () => {
    // A hostile frame may claim four billion entries. The count is bounded, so
    // one bad socket cannot make every message on the board slow.
    const bytes = Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x03]);
    expect(readAwarenessClients(bytes)).toBeNull();
  });
});

describe('mergeTracked', () => {
  it('keeps the highest clock for a client and adds new ones', () => {
    expect(mergeTracked({ '7': 3 }, new Map([[7, 5], [9, 1]]))).toEqual({ '7': 5, '9': 1 });
    // An older version of the same state changes nothing: clocks only move
    // forward, and a tracker that went backwards would re-announce people who
    // have already been told about.
    expect(mergeTracked({ '7': 5 }, new Map([[7, 2]]))).toEqual({ '7': 5 });
    expect(mergeTracked({ '7': 5 }, new Map([[7, 5]]))).toEqual({ '7': 5 });
  });

  it('leaves what it was given alone, and hands back a plain object', () => {
    const previous = { '7': 2, '9': 4 };
    const merged = mergeTracked(previous, new Map());
    expect(merged).toEqual({ '7': 2, '9': 4 });
    expect(merged).not.toBe(previous);
    // It goes into a WebSocket attachment, which is serialised as JSON: a Map
    // would arrive back as `{}` and the removal on close would find nobody.
    expect(JSON.parse(JSON.stringify(merged))).toEqual(merged);
  });

  it('does not resurrect a client from a removal frame', () => {
    // A removal names its ids but reports nobody as present, so reading it and
    // merging the result changes nothing.
    const read = readAwarenessClients(removalPayload(new Map([[7, 3]])))!;
    expect(mergeTracked({ '7': 3 }, read)).toEqual({ '7': 3 });
  });
});

describe('clientsFromAttachment', () => {
  it('reads back what an attachment held, and nothing when there was none', () => {
    expect(clientsFromAttachment(undefined)).toEqual(new Map());
    expect(clientsFromAttachment({})).toEqual(new Map());
    expect(clientsFromAttachment({ '7': 2, '2983377874': 1 })).toEqual(
      new Map([[7, 2], [2_983_377_874, 1]]),
    );
    // Junk from an older or foreign attachment is skipped rather than trusted.
    expect(clientsFromAttachment({ 'not-a-number': 1, '7': Number.NaN })).toEqual(new Map());
  });
});
