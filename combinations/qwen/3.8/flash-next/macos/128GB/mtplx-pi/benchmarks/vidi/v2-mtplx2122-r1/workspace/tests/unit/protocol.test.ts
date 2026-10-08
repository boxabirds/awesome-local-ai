import { describe, it, expect, afterEach } from 'vitest'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  SYNC_STEP1,
  SYNC_STEP2,
  SYNC_UPDATE,
  decodeMessage,
  encodeFrame,
} from '../../src/shared/protocol'

// ── fixtures ─────────────────────────────────────────────────────────────────

const docs: Y.Doc[] = []
const awarenesses: awarenessProtocol.Awareness[] = []

function freshDoc(): Y.Doc {
  const doc = new Y.Doc()
  docs.push(doc)
  return doc
}

function freshAwareness(doc: Y.Doc): awarenessProtocol.Awareness {
  const awareness = new awarenessProtocol.Awareness(doc)
  awarenesses.push(awareness)
  return awareness
}

afterEach(() => {
  while (awarenesses.length > 0) awarenesses.pop()!.destroy()
  while (docs.length > 0) docs.pop()!.destroy()
})

/** Build a frame the same way the y-websocket client provider does. */
function syncFrame(write: (encoder: encoding.Encoder) => void): ArrayBuffer {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  write(encoder)
  return encoding.toUint8Array(encoder).buffer
}

// ── TC-03 decodeMessage ──────────────────────────────────────────────────────

describe('TC-03 decodeMessage — valid frames', () => {
  it('decodes a SyncStep1 frame into { kind: "sync" } with the body after the type byte', () => {
    const doc = freshDoc()
    const frame = syncFrame(encoder => syncProtocol.writeSyncStep1(encoder, doc))

    const decoded = decodeMessage(frame)

    expect(decoded.kind).toBe('sync')
    if (decoded.kind !== 'sync') return
    // Payload keeps the sync message type so readSyncMessage can read it.
    expect(decoded.payload[0]).toBe(SYNC_STEP1)
    expect(decoded.payload.byteLength).toBe(new Uint8Array(frame).byteLength - 1)
  })

  it('decodes a SyncStep2 frame carrying a whole-document update', () => {
    const source = freshDoc()
    source.getMap('objects').set('a', 'b')
    const frame = syncFrame(encoder => syncProtocol.writeSyncStep2(encoder, source))

    const decoded = decodeMessage(frame)

    expect(decoded.kind).toBe('sync')
    if (decoded.kind !== 'sync') return
    expect(decoded.payload[0]).toBe(SYNC_STEP2)
  })

  it('decodes an update frame (sync type 2)', () => {
    const source = freshDoc()
    source.getMap('objects').set('a', 'b')
    const update = Y.encodeStateAsUpdate(source)
    const frame = syncFrame(encoder => syncProtocol.writeUpdate(encoder, update))

    const decoded = decodeMessage(frame)

    expect(decoded.kind).toBe('sync')
    if (decoded.kind !== 'sync') return
    expect(decoded.payload[0]).toBe(SYNC_UPDATE)
  })

  it('decodes an awareness frame and hands back the complete frame for relaying', () => {
    const doc = freshDoc()
    const awareness = freshAwareness(doc)
    awareness.setLocalStateField('cursor', { x: 1, y: 2 })
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID])
    const frame = encodeFrame(MESSAGE_AWARENESS, update)

    const decoded = decodeMessage(frame.buffer as ArrayBuffer)

    expect(decoded.kind).toBe('awareness')
    if (decoded.kind !== 'awareness') return
    // Relayed verbatim, so the receiver still sees its own type byte.
    expect(Array.from(decoded.payload)).toEqual(Array.from(frame))
    expect(decoded.payload[0]).toBe(MESSAGE_AWARENESS)
  })

  it('decodes a query-awareness frame with no payload', () => {
    const frame = new Uint8Array([MESSAGE_QUERY_AWARENESS])
    expect(decodeMessage(frame.buffer as ArrayBuffer)).toEqual({ kind: 'query-awareness' })
  })
})

describe('TC-03 decodeMessage — error paths', () => {
  it('reports text frames as invalid', () => {
    expect(decodeMessage('hello').kind).toBe('invalid')
    expect(decodeMessage('0').kind).toBe('invalid')
  })

  it('reports unknown message types as invalid', () => {
    const frame = new Uint8Array([9, 1, 2, 3])
    const decoded = decodeMessage(frame.buffer as ArrayBuffer)
    expect(decoded.kind).toBe('invalid')
    expect((decoded as { reason: string }).reason).toContain('9')
  })

  it('reports truncated frames as invalid', () => {
    // SyncStep2 that declares 5 payload bytes but only carries 2.
    const truncated = new Uint8Array([MESSAGE_SYNC, SYNC_STEP2, 5, 0xaa, 0xbb])
    expect(decodeMessage(truncated.buffer as ArrayBuffer).kind).toBe('invalid')

    // Type byte only.
    expect(decodeMessage(new Uint8Array([MESSAGE_SYNC]).buffer as ArrayBuffer).kind).toBe('invalid')
    expect(
      decodeMessage(new Uint8Array([MESSAGE_AWARENESS]).buffer as ArrayBuffer).kind,
    ).toBe('invalid')

    // Awareness update claiming more bytes than the frame holds.
    expect(decodeMessage(new Uint8Array([MESSAGE_AWARENESS, 10, 1, 2]).buffer as ArrayBuffer).kind).toBe(
      'invalid',
    )

    // Empty frame.
    expect(decodeMessage(new Uint8Array([]).buffer as ArrayBuffer).kind).toBe('invalid')
  })

  it('keeps the close code used for these frames at 1003', () => {
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003)
  })
})
