/**
 * TC-27 — the room lifecycle state machine, tested edge by edge against the
 * diagram in the story 4 design.
 *
 * The room uses this function for its real transitions, so "invalid events
 * leave the state unchanged" is not just a maths property: an event that
 * cannot happen in a state must not be able to move it.
 */

import { describe, expect, it } from 'vitest'
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config'
import { ROOM_STATES, nextRoomState, blocksUpdates, type RoomState } from '../../src/worker/room-state'

const STATES: RoomState[] = ['loading', 'ready', 'compacting', 'hibernated', 'storage-failed', 'load-failed']

describe('TC-27 nextRoomState: every edge of the lifecycle diagram', () => {
  it('Loading → Ready when the snapshot and the log applied', () => {
    expect(nextRoomState('loading', { type: 'load-result', ok: true, quarantined: 0 })).toBe('ready')
  })

  it('Loading → Ready when damaged log rows were quarantined and the rest applied', () => {
    expect(nextRoomState('loading', { type: 'load-result', ok: true, quarantined: 3 })).toBe('ready')
  })

  it('Loading → LoadFailed for an unreadable snapshot or a SQL error', () => {
    expect(nextRoomState('loading', { type: 'load-result', ok: false, quarantined: 0 })).toBe('load-failed')
  })

  it('Ready → Ready for a stored update below the compaction threshold', () => {
    expect(nextRoomState('ready', { type: 'update', overThreshold: false })).toBe('ready')
  })

  it('Ready → Compacting when the log exceeds the threshold', () => {
    expect(nextRoomState('ready', { type: 'update', overThreshold: true })).toBe('compacting')
  })

  it('Compacting → Ready after a successful compaction and after a rolled-back one', () => {
    expect(nextRoomState('compacting', { type: 'compact', ok: true })).toBe('ready')
    expect(nextRoomState('compacting', { type: 'compact', ok: false })).toBe('ready')
  })

  it('Ready → StorageFailed when an insert throws', () => {
    expect(nextRoomState('ready', { type: 'storage-error' })).toBe('storage-failed')
  })

  it('Compacting → StorageFailed when the failing statement is inside the transaction', () => {
    expect(nextRoomState('compacting', { type: 'storage-error' })).toBe('storage-failed')
  })

  it('StorageFailed → Loading on the next connection (doc discarded, sockets closed)', () => {
    expect(nextRoomState('storage-failed', { type: 'wake' })).toBe('loading')
    expect(nextRoomState('storage-failed', { type: 'client-open', elapsedMs: 0 })).toBe('loading')
  })

  it('Ready → Hibernated while nobody sends anything', () => {
    expect(nextRoomState('ready', { type: 'idle' })).toBe('hibernated')
  })

  it('Hibernated → Loading on a message or a new connection', () => {
    expect(nextRoomState('hibernated', { type: 'wake' })).toBe('loading')
    expect(nextRoomState('hibernated', { type: 'client-open', elapsedMs: 0 })).toBe('loading')
  })

  it('LoadFailed → Loading on a new connection once the retry interval elapsed', () => {
    expect(
      nextRoomState('load-failed', { type: 'client-open', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS }),
    ).toBe('loading')
    expect(
      nextRoomState('load-failed', { type: 'client-open', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS + 1 }),
    ).toBe('loading')
  })

  it('LoadFailed stays LoadFailed before the retry interval, so the socket is closed 4500', () => {
    for (const elapsedMs of [0, 1, LOAD_RETRY_MIN_INTERVAL_MS - 1]) {
      expect(nextRoomState('load-failed', { type: 'client-open', elapsedMs })).toBe('load-failed')
    }
  })

  it('Ready → Ready on a new connection: nobody is evicted by a joiner', () => {
    expect(nextRoomState('ready', { type: 'client-open', elapsedMs: 0 })).toBe('ready')
  })
})

describe('TC-27 nextRoomState: invalid events leave the state unchanged', () => {
  const invalid: [RoomState, Parameters<typeof nextRoomState>[1]][] = [
    // While loading nothing else may decide the outcome.
    ['loading', { type: 'update', overThreshold: true }],
    ['loading', { type: 'idle' }],
    ['loading', { type: 'wake' }],
    ['loading', { type: 'client-open', elapsedMs: 10_000 }],
    ['loading', { type: 'compact', ok: true }],
    // A board that works is not put back into loading by its own traffic.
    ['ready', { type: 'wake' }],
    ['ready', { type: 'load-result', ok: true, quarantined: 0 }],
    ['ready', { type: 'compact', ok: false }],
    // Compaction is bounded: only its own outcome (or a storage error) ends it.
    ['compacting', { type: 'update', overThreshold: true }],
    ['compacting', { type: 'idle' }],
    ['compacting', { type: 'wake' }],
    // A broken board is not "repaired" by traffic.
    ['load-failed', { type: 'update', overThreshold: false }],
    ['load-failed', { type: 'wake' }],
    ['load-failed', { type: 'idle' }],
    ['storage-failed', { type: 'update', overThreshold: false }],
    ['storage-failed', { type: 'idle' }],
    ['hibernated', { type: 'update', overThreshold: true }],
    ['hibernated', { type: 'idle' }],
  ]

  it.each(invalid)('%s + %o stays %s', (state, event) => {
    expect(nextRoomState(state, event)).toBe(state)
  })

  it('returns one of the declared states for every state × event pair', () => {
    const events = [
      { type: 'load-result', ok: true, quarantined: 0 },
      { type: 'load-result', ok: true, quarantined: 2 },
      { type: 'load-result', ok: false, quarantined: 0 },
      { type: 'update', overThreshold: false },
      { type: 'update', overThreshold: true },
      { type: 'compact', ok: true },
      { type: 'compact', ok: false },
      { type: 'storage-error' },
      { type: 'idle' },
      { type: 'wake' },
      { type: 'client-open', elapsedMs: 0 },
      { type: 'client-open', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS },
    ] as const
    for (const state of STATES) {
      for (const event of events) {
        expect(ROOM_STATES).toContain(nextRoomState(state, event))
      }
    }
  })
})

describe('TC-27 blocksUpdates', () => {
  it('refuses document traffic while the board is not readable', () => {
    expect(blocksUpdates('loading')).toBe(true)
    expect(blocksUpdates('load-failed')).toBe(true)
    expect(blocksUpdates('storage-failed')).toBe(true)
  })

  it('accepts document traffic once the room is usable again', () => {
    expect(blocksUpdates('ready')).toBe(false)
    expect(blocksUpdates('compacting')).toBe(false)
    expect(blocksUpdates('hibernated')).toBe(false)
  })
})
