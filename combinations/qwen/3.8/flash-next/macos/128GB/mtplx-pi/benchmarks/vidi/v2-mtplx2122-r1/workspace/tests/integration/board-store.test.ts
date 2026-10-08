/**
 * BoardStore against real Durable Object SQLite (story 4, `persist.board_store`).
 *
 * Every case runs *inside* a `BoardRoom` Durable Object through
 * `runInDurableObject`, so the SQLite engine, its transactions and its BLOB
 * handling are the ones the deployed Worker uses (a BLOB comes back as an
 * `ArrayBuffer` there, which is why `BoardStore` normalises with `asBytes`).
 * Each case uses its own board id and therefore its own database: the pool
 * shares storage between tests, so isolation is by id (`uniqueBoardId`).
 *
 * Damage is written with real SQL against real tables, and write failures are
 * injected by wrapping the storage object. The wrapper sits outside SQLite, so
 * transaction semantics still apply (design "Mock vs real boundaries").
 */

import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { env, runInDurableObject } from 'cloudflare:test'
import { COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES, STORAGE_SCHEMA_VERSION } from '../../src/shared/config'
import { BoardStore, asBytes, type StorageLike } from '../../src/worker/board-store'
import { moveObject, snapshot } from '../../src/shared/board-model'
import { clusteredBoard, retroBoard, sameState, boardContent } from '../fixtures/boards'
import { uniqueBoardId } from './ws-client'

/** Env of the Worker under test (only the DO binding is relevant here). */
interface TestEnv {
  BOARD_ROOM: DurableObjectNamespace
}

const testEnv = env as unknown as TestEnv

/** Run `caseFn` inside a Durable Object that owns its own SQLite database. */
function inStore<R>(boardId: string, caseFn: (store: BoardStore, storage: StorageLike) => R): Promise<R> {
  const namespace = testEnv.BOARD_ROOM
  const stub = namespace.get(namespace.idFromName(boardId))
  return runInDurableObject(
    stub as unknown as Parameters<typeof runInDurableObject>[0],
    async (_instance, state) => {
      const storage = (state as unknown as { storage: StorageLike }).storage
      return caseFn(new BoardStore(storage), storage)
    },
  )
}

/** Rows as plain data: the Durable Object boundary can serialise these. */
function rows(storage: StorageLike, query: string, ...bindings: unknown[]): Record<string, unknown>[] {
  return [...storage.sql.exec(query, ...bindings)].map(row => ({ ...row }))
}

function countOf(storage: StorageLike, table: string): number {
  return Number(rows(storage, `SELECT COUNT(*) AS n FROM ${table}`)[0].n)
}

// ── fixtures ─────────────────────────────────────────────────────────────────

interface LogFixture {
  /** One entry per log row, in the order they were produced. */
  updates: Uint8Array[]
  /** The board those rows add up to. */
  doc: Y.Doc
}

/**
 * A board plus enough extra single-transaction updates (small moves) to reach
 * `rows` log rows. A long-lived board accumulates exactly this kind of traffic,
 * which is why the log has to compact.
 */
function logFixture(rows: number, base = retroBoard()): LogFixture {
  const doc = new Y.Doc()
  const updates: Uint8Array[] = []
  doc.on('update', update => updates.push(new Uint8Array(update)))
  for (const update of base.updates) Y.applyUpdate(doc, update, 'seed')
  for (let i = 0; updates.length < rows; i++) {
    const noteId = base.noteIds[i % base.noteIds.length]
    moveObject(doc, noteId, 10 + (i % 200), (i % 13) * 4)
  }
  return { updates: updates.slice(0, rows), doc }
}

/** A doc holding the first `count` log rows (the state storage is in). */
function docWith(updates: Uint8Array[], count: number): Y.Doc {
  const doc = new Y.Doc()
  for (let i = 0; i < count; i++) Y.applyUpdate(doc, updates[i], 'seed')
  return doc
}

/** Deterministic pseudo-random bytes: same length as asked, no meaning. */
function noise(length: number, seed = 20261008): Uint8Array {
  let a = seed
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    a = (a * 1103515245 + 12345) & 0x7fffffff
    out[i] = (a >>> 8) % 256
  }
  return out
}

/** True when Yjs refuses these bytes — that is what makes them "damaged". */
function undecodable(bytes: Uint8Array): boolean {
  try {
    Y.applyUpdate(new Y.Doc(), bytes)
    return false
  } catch {
    return true
  }
}

// ── TC-03, TC-25 empty board ─────────────────────────────────────────────────

describe('TC-03 migrate + load on an empty board', () => {
  it('creates the four tables, leaves the doc empty, records the schema version', async () => {
    const boardId = uniqueBoardId('tc03')
    const result = await inStore(boardId, (store, storage) => {
      store.migrate()
      const doc = new Y.Doc()
      const load = store.load(doc)
      return {
        load,
        tables: rows(storage, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
          .map(row => String(row.name))
          .sort(),
        notes: snapshot(doc).length,
        version: store.metaValue('storage_schema_version'),
        docBytes: Y.encodeStateAsUpdate(doc).byteLength,
      }
    })

    // `sqlite_sequence` is SQLite's own bookkeeping for the log table's
    // AUTOINCREMENT, not one of ours.
    expect(result.tables.filter(name => !name.startsWith('sqlite_'))).toEqual([
      'quarantined_updates',
      'snapshot_chunks',
      'storage_meta',
      'updates',
    ])
    expect(result.load).toEqual({ ok: true, quarantined: 0 })
    expect(result.notes).toBe(0)
    expect(result.version).toBe(String(STORAGE_SCHEMA_VERSION))
    // Only the document skeleton, no board content.
    expect(result.docBytes).toBeLessThan(64)
  })

  it('TC-25: opening a board that was never edited creates no rows', async () => {
    const boardId = uniqueBoardId('tc25')
    const result = await inStore(boardId, (store, storage) => {
      const load = store.load(new Y.Doc())
      return {
        load,
        updates: countOf(storage, 'updates'),
        chunks: countOf(storage, 'snapshot_chunks'),
        quarantined: countOf(storage, 'quarantined_updates'),
        meta: rows(storage, 'SELECT key FROM storage_meta').map(row => String(row.key)),
      }
    })

    expect(result.load).toEqual({ ok: true, quarantined: 0 })
    expect(result.updates).toBe(0)
    expect(result.chunks).toBe(0)
    expect(result.quarantined).toBe(0)
    // The only thing a wake writes is the schema version.
    expect(result.meta).toEqual(['storage_schema_version'])
  })
})

// ── TC-04 append ─────────────────────────────────────────────────────────────

describe('TC-04 append', () => {
  it('writes one row whose bytes column is the update length', async () => {
    const boardId = uniqueBoardId('tc04')
    const fixture = retroBoard()
    const first = fixture.updates[0]

    const result = await inStore(boardId, (store, storage) => {
      store.migrate()
      store.append(first)
      return {
        stored: rows(storage, 'SELECT seq, bytes, length(data) AS len FROM updates'),
        stats: store.logStats,
      }
    })

    expect(result.stored).toEqual([{ seq: 1, bytes: first.byteLength, len: first.byteLength }])
    expect(result.stats).toMatchObject({ count: 1, bytes: first.byteLength, throughSeq: 0, maxSeq: 1 })
  })

  it('keeps sequence numbers above the snapshot high-water mark', async () => {
    const boardId = uniqueBoardId('tc04-seq')
    const fixture = logFixture(COMPACTION_UPDATE_COUNT + 1)

    const result = await inStore(boardId, (store, storage) => {
      store.migrate()
      for (const update of fixture.updates) store.append(update)
      const before = rows(storage, 'SELECT seq FROM updates ORDER BY seq').map(row => Number(row.seq))

      store.compactIfNeeded(fixture.doc)
      const duringCompaction = countOf(storage, 'updates')
      // A new change on top of a compacted snapshot must not reuse a sequence
      // number the snapshot already covers.
      store.append(fixture.updates[0])

      return {
        before,
        duringCompaction,
        after: rows(storage, 'SELECT seq FROM updates ORDER BY seq').map(row => Number(row.seq)),
        through: store.metaValue('snapshot_through_seq'),
      }
    })

    expect(result.before).toHaveLength(COMPACTION_UPDATE_COUNT + 1)
    expect(result.duringCompaction).toBe(0)
    expect(result.after).toEqual([COMPACTION_UPDATE_COUNT + 2])
    expect(result.through).toBe(String(COMPACTION_UPDATE_COUNT + 1))
  })
})

// ── TC-05 log only ───────────────────────────────────────────────────────────

describe('TC-05 a 25-note board stored as a log', () => {
  it('loads back into a fresh doc with identical content', async () => {
    const boardId = uniqueBoardId('tc05')
    const fixture = retroBoard()
    const original = boardContent(fixture.doc)

    const result = await inStore(boardId, (store, storage) => {
      store.migrate()
      for (const update of fixture.updates) store.append(update)

      const doc = new Y.Doc()
      const load = store.load(doc)
      return {
        load,
        content: boardContent(doc),
        identical: sameState(fixture.doc, doc),
        rowsWritten: countOf(storage, 'updates'),
        rowsRead: store.logStats.count,
      }
    })

    expect(result.load).toEqual({ ok: true, quarantined: 0 })
    expect(result.rowsWritten).toBe(fixture.updates.length)
    expect(result.rowsRead).toBe(fixture.updates.length)
    expect(result.content).toBe(original)
    // Not just "the same notes": the same document, delete sets included.
    expect(result.identical).toBe(true)
  })
})

// ── TC-06 compaction threshold ───────────────────────────────────────────────

describe('TC-06 a log that reaches COMPACTION_UPDATE_COUNT', () => {
  it('does not compact one row early, and folds the whole log when it crosses', async () => {
    const boardId = uniqueBoardId('tc06')
    const fixture = logFixture(COMPACTION_UPDATE_COUNT + 1)

    const result = await inStore(boardId, (store, storage) => {
      store.migrate()

      // One below the threshold: the log stays as it is.
      const below = fixture.updates.slice(0, COMPACTION_UPDATE_COUNT - 1)

      for (const update of below) store.append(update)
      const source = docWith(fixture.updates, COMPACTION_UPDATE_COUNT - 1)
      const skipped = store.compactIfNeeded(source)
      const rowsBelow = countOf(storage, 'updates')
      const statsBelow = store.logStats

      // Exactly at the threshold.
      const rest = fixture.updates.slice(COMPACTION_UPDATE_COUNT - 1, COMPACTION_UPDATE_COUNT)
      for (const update of rest) store.append(update)
      source.destroy()
      const full = docWith(fixture.updates, COMPACTION_UPDATE_COUNT)
      const compacted = store.compactIfNeeded(full)

      const summary = {
        skipped,
        rowsBelow,
        statsBelow,
        compacted,
        rowsAfter: countOf(storage, 'updates'),
        chunks: countOf(storage, 'snapshot_chunks'),
        chunkSizes: rows(storage, 'SELECT idx, length(data) AS len FROM snapshot_chunks ORDER BY idx').map(
          row => Number(row.len),
        ),
        through: store.metaValue('snapshot_through_seq'),
        stats: store.logStats,
      }

      const reloaded = new Y.Doc()
      const load = store.load(reloaded)
      return {
        ...summary,
        reloaded: boardContent(reloaded),
        // The padded moves relocate notes, so the state in storage is the
        // stored rows, not the fixture as it started out.
        expected: boardContent(docWith(fixture.updates, COMPACTION_UPDATE_COUNT)),
        load,
      }
    })

    expect(result.skipped).toBe(false)
    expect(result.rowsBelow).toBe(COMPACTION_UPDATE_COUNT - 1)
    expect(result.statsBelow).toMatchObject({ count: COMPACTION_UPDATE_COUNT - 1, maxSeq: COMPACTION_UPDATE_COUNT - 1 })
    expect(result.compacted).toBe(true)
    expect(result.rowsAfter).toBe(0)
    expect(result.chunks).toBeGreaterThanOrEqual(1)
    expect(result.through).toBe(String(COMPACTION_UPDATE_COUNT))
    expect(result.stats).toMatchObject({ count: 0, bytes: 0, throughSeq: COMPACTION_UPDATE_COUNT })
    // The board a joiner gets is the board that was compacted.
    expect(result.reloaded).toBe(result.expected)
    expect(result.load).toEqual({ ok: true, quarantined: 0 })
  })
})

// ── TC-07 snapshot plus log ──────────────────────────────────────────────────

describe('TC-07 updates appended after a compaction', () => {
  it('all of them come back, and only rows above through_seq are replayed', async () => {
    const boardId = uniqueBoardId('tc07')
    const fixture = logFixture(COMPACTION_UPDATE_COUNT + 3)
    const SPLIT = COMPACTION_UPDATE_COUNT

    const result = await inStore(boardId, (store, storage) => {
      store.migrate()
      for (const update of fixture.updates.slice(0, SPLIT)) store.append(update)
      const source = docWith(fixture.updates, SPLIT)
      expect(store.compactIfNeeded(source)).toBe(true)
      const through = store.logStats.throughSeq

      const rest = fixture.updates.slice(SPLIT)
      for (const update of rest) store.append(update)
      source.destroy()

      // A second store, as a freshly woken object would have: it must read the
      // snapshot and *only* the rows above the snapshot's high-water mark.
      const second = new BoardStore(storage)
      const target = docWith([], 0)
      const load = second.load(target)
      return {
        through,
        restCount: rest.length,
        load,
        rowsRead: second.logStats.count,
        identical: sameState(docWith(fixture.updates, COMPACTION_UPDATE_COUNT + 3), target),
        content: boardContent(target),
        expected: boardContent(docWith(fixture.updates, COMPACTION_UPDATE_COUNT + 3)),
      }
    })

    expect(result.through).toBe(COMPACTION_UPDATE_COUNT)
    expect(result.restCount).toBe(3)
    expect(result.load).toEqual({ ok: true, quarantined: 0 })
    // Snapshot plus three rows, not 503.
    expect(result.rowsRead).toBe(3)
    expect(result.identical).toBe(true)
    expect(result.content).toBe(result.expected)
  })
})

// ── TC-08 a large board ──────────────────────────────────────────────────────

describe('TC-08 compaction of a PERSIST_TESTED_NOTES board', () => {
  it('splits a snapshot larger than one chunk and reloads it identically', async () => {
    const boardId = uniqueBoardId('tc08')
    const fixture = clusteredBoard()
    const encoded = Y.encodeStateAsUpdate(fixture.doc)

    const result = await inStore(boardId, (store, storage) => {
      store.migrate()
      for (const update of fixture.updates) store.append(update)

      const compacted = store.compactIfNeeded(fixture.doc)
      const chunks = rows(storage, 'SELECT idx, length(data) AS len FROM snapshot_chunks ORDER BY idx')

      const reloaded = new Y.Doc()
      const load = store.load(reloaded)
      return {
        compacted,
        chunks: chunks.map(row => ({ idx: Number(row.idx), len: Number(row.len) })),
        logRows: countOf(storage, 'updates'),
        load,
        notes: snapshot(reloaded).length,
        content: boardContent(reloaded),
        identical: sameState(fixture.doc, reloaded),
      }
    })

    expect(encoded.byteLength).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES)
    expect(result.compacted).toBe(true)
    expect(result.chunks.length).toBeGreaterThan(1)
    expect(result.chunks.length).toBe(Math.ceil(encoded.byteLength / SNAPSHOT_CHUNK_BYTES))
    for (const chunk of result.chunks) expect(chunk.len).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES)
    expect(result.logRows).toBe(0)
    expect(result.notes).toBe(2000)
    expect(result.load).toEqual({ ok: true, quarantined: 0 })
    expect(result.content).toBe(boardContent(fixture.doc))
    expect(result.identical).toBe(true)
  }, 180_000)
})

// ── TC-09 damaged log row ────────────────────────────────────────────────────

describe('TC-09 a damaged update row', () => {
  it('is quarantined and the half-read board is refused', async () => {
    const boardId = uniqueBoardId('tc09')
    const fixture = retroBoard()

    const result = await inStore(boardId, (store, storage) => {
      store.migrate()
      for (const update of fixture.updates) store.append(update)

      const damage = noise(200)
      storage.transactionSync(() => {
        storage.sql.exec('UPDATE updates SET data = ? WHERE seq = 7', damage)
      })

      const doc = new Y.Doc()
      const load = store.load(doc)
      return {
        damaged: undecodable(damage),
        load,
        error: load.ok ? '' : load.error,
        rowsBefore: fixture.updates.length,
        rowsAfter: countOf(storage, 'updates'),
        notes: snapshot(doc).length,
        // What the room would have served had it kept the half-read doc: proof
        // that stopping is the safer answer (see `BoardStore.load`).
        servedNotesIfTrusted: (() => {
          const trusting = new Y.Doc()
          for (const row of storage.sql.exec<{ data: Uint8Array | ArrayBuffer }>(
            'SELECT data FROM updates ORDER BY seq',
          )) {
            try {
              Y.applyUpdate(trusting, asBytes(row.data))
            } catch {
              // skipped, like a store that treated damage as ordinary
            }
          }
          return snapshot(trusting).length
        })(),
        quarantined: rows(storage, 'SELECT seq, error, length(data) AS len FROM quarantined_updates'),
      }
    })

    expect(result.damaged).toBe(true)
    // The damage is reported, not swallowed: no board is served from it.
    expect(result.load).toMatchObject({ ok: false, reason: 'log-unreadable', quarantined: 1 })
    expect(result.error.length).toBeGreaterThan(0)
    // The row is out of the log and into quarantine, error text and all, so the
    // next wake does not fail on the same bytes.
    expect(result.rowsAfter).toBe(result.rowsBefore - 1)
    expect(result.quarantined).toHaveLength(1)
    expect(Number(result.quarantined[0].seq)).toBe(7)
    expect(String(result.quarantined[0].error).length).toBeGreaterThan(0)
    // And the doc the room was handed never went past a fragment of the board.
    expect(result.notes).toBeLessThan(5)
    expect(result.servedNotesIfTrusted).toBeLessThan(5)
  })

  it('quarantines a truncated update the same way', async () => {
    const boardId = uniqueBoardId('tc09-trunc')
    const fixture = retroBoard()

    const result = await inStore(boardId, (store, storage) => {
      store.migrate()
      for (const update of fixture.updates) store.append(update)

      const row = rows(storage, 'SELECT data FROM updates WHERE seq = 9')[0]
      const original = asBytes(row.data as Uint8Array | ArrayBuffer)
      const truncated = original.slice(0, original.byteLength - 10)
      // The damage has to be damage: if Yjs could still read it, this would not
      // be an error path at all.
      const damaged = undecodable(truncated)

      storage.transactionSync(() => {
        storage.sql.exec('UPDATE updates SET data = ? WHERE seq = 9', truncated)
      })

      const doc = new Y.Doc()
      const load = store.load(doc)
      return { damaged, load, rowsAfter: countOf(storage, 'updates') }
    })

    expect(result.damaged).toBe(true)
    expect(result.load).toMatchObject({ ok: false, reason: 'log-unreadable', quarantined: 1 })
    expect(result.rowsAfter).toBe(fixture.updates.length - 1)
  })
})

// ── TC-10 damaged snapshot ───────────────────────────────────────────────────

describe('TC-10 a damaged snapshot chunk', () => {
  it('refuses to serve the board and deletes or quarantines nothing', async () => {
    const boardId = uniqueBoardId('tc10')
    const fixture = logFixture(COMPACTION_UPDATE_COUNT + 3)

    const result = await inStore(boardId, (store, storage) => {
      store.migrate()
      for (const update of fixture.updates.slice(0, COMPACTION_UPDATE_COUNT)) store.append(update)
      const source = docWith(fixture.updates, COMPACTION_UPDATE_COUNT)
      expect(store.compactIfNeeded(source)).toBe(true)

      // Log rows on top of the snapshot, so "nothing deleted" has something to
      // be deleted.
      const rest = fixture.updates.slice(COMPACTION_UPDATE_COUNT)
      for (const update of rest) store.append(update)

      const chunksBefore = rows(storage, 'SELECT idx, length(data) AS len FROM snapshot_chunks ORDER BY idx')
      const logBefore = countOf(storage, 'updates')
      const firstChunkSize = Number(chunksBefore[0].len)

      // Corrupt chunk 0 with the same number of meaningless bytes.
      const damage = noise(firstChunkSize)
      storage.transactionSync(() => {
        storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', damage)
      })

      const doc = new Y.Doc()
      const load = store.load(doc)
      return {
        damaged: undecodable(damage),
        chunkCount: chunksBefore.length,
        load,
        logBefore,
        chunksAfter: countOf(storage, 'snapshot_chunks'),
        logAfter: countOf(storage, 'updates'),
        quarantined: countOf(storage, 'quarantined_updates'),
        notes: snapshot(doc).length,
      }
    })

    expect(result.damaged).toBe(true)
    expect(result.chunkCount).toBeGreaterThan(0)
    expect(result.load).toMatchObject({ ok: false, reason: 'snapshot-unreadable' })
    // Nothing was destroyed on the way out: a repair can still load the board.
    expect(result.chunksAfter).toBe(result.chunkCount)
    expect(result.logAfter).toBe(result.logBefore)
    expect(result.quarantined).toBe(0)
    // And the room never served a half-read board.
    expect(result.notes).toBe(0)
  })
})

// ── TC-11 a compaction that fails halfway ────────────────────────────────────

/** A storage wrapper that fails the Nth statement matching `prefix`. */
function failOnChunkInsert(storage: StorageLike, nth: number): { storage: StorageLike; failures: () => number } {
  let attempts = 0
  let failures = 0
  return {
    storage: {
      sql: {
        exec(query: string, ...bindings: unknown[]) {
          // The failure lands after the snapshot was deleted and `nth` chunks
          // were written: exactly where a rollback has to protect.
          if (query.startsWith('INSERT INTO snapshot_chunks')) {
            if (attempts++ === nth) {
              failures++
              throw new Error('injected disk failure')
            }
          }
          return storage.sql.exec(query, ...bindings)
        },
      },
      transactionSync: closure => storage.transactionSync(closure),
    },
    failures: () => failures,
  }
}

describe('TC-11 a compaction interrupted by a storage error', () => {
  it('rolls the whole transaction back: snapshot and log are as they were', async () => {
    const boardId = uniqueBoardId('tc11')
    const fixture = logFixture(COMPACTION_UPDATE_COUNT * 2 + 1)

    const result = await inStore(boardId, (store, storage) => {
      store.migrate()
      // Snapshot first …
      for (const update of fixture.updates.slice(0, COMPACTION_UPDATE_COUNT)) store.append(update)
      expect(store.compactIfNeeded(docWith(fixture.updates, COMPACTION_UPDATE_COUNT))).toBe(true)
      const snapshotRows = countOf(storage, 'snapshot_chunks')

      // … then a log on top of it, over the threshold again.
      for (const update of fixture.updates.slice(COMPACTION_UPDATE_COUNT)) store.append(update)

      const before = {
        chunks: rows(storage, 'SELECT idx, length(data) AS len FROM snapshot_chunks ORDER BY idx'),
        log: countOf(storage, 'updates'),
        through: store.metaValue('snapshot_through_seq'),
      }

      // A fresh wake: load (which is how a real room gets its counters), then
      // try to compact with a statement that throws.
      const failing = failOnChunkInsert(storage, 0)
      const broken = new BoardStore(failing.storage)
      const probe = new Y.Doc()
      const load = broken.load(probe)
      const compacted = broken.compactIfNeeded(probe)

      const after = {
        chunks: rows(storage, 'SELECT idx, length(data) AS len FROM snapshot_chunks ORDER BY idx'),
        log: countOf(storage, 'updates'),
        through: store.metaValue('snapshot_through_seq'),
      }

      // Nothing lost, so the board still loads — from a longer log.
      const reloaded = new Y.Doc()
      const retry = new BoardStore(storage).load(reloaded)
      return {
        snapshotRows,
        injected: failing.failures(),
        load,
        compacted,
        before,
        after,
        retry,
        identical: sameState(docWith(fixture.updates, COMPACTION_UPDATE_COUNT * 2 + 1), reloaded),
      }
    })

    expect(result.snapshotRows).toBeGreaterThan(0)
    expect(result.load).toEqual({ ok: true, quarantined: 0 })
    expect(result.injected).toBe(1)
    expect(result.compacted).toBe(false)
    expect(result.after.chunks).toEqual(result.before.chunks)
    expect(result.after.log).toBe(result.before.log)
    expect(result.after.through).toBe(result.before.through)
    expect(result.retry).toEqual({ ok: true, quarantined: 0 })
    expect(result.identical).toBe(true)
  })

  it('still compacts on the next wake, because nothing was lost', async () => {
    const boardId = uniqueBoardId('tc11-retry')
    const fixture = logFixture(COMPACTION_UPDATE_COUNT * 2 + 1)

    const result = await inStore(boardId, (store, storage) => {
      store.migrate()
      for (const update of fixture.updates.slice(0, COMPACTION_UPDATE_COUNT)) store.append(update)
      expect(store.compactIfNeeded(docWith(fixture.updates, COMPACTION_UPDATE_COUNT))).toBe(true)
      for (const update of fixture.updates.slice(COMPACTION_UPDATE_COUNT)) store.append(update)

      const failing = failOnChunkInsert(storage, 0)
      const broken = new BoardStore(failing.storage)
      const first = new Y.Doc()
      broken.load(first)
      const failed = broken.compactIfNeeded(first)
      const logBetween = countOf(storage, 'updates')

      // The next wake gets a healthy store, and the rollback left it something
      // to work with: the whole log is still there, so nothing is missing.
      const healthy = new BoardStore(storage)
      const second = new Y.Doc()
      const load = healthy.load(second)
      const compacted = healthy.compactIfNeeded(second)

      return {
        failed,
        logBetween,
        load,
        compacted,
        logAfter: countOf(storage, 'updates'),
        chunksAfter: countOf(storage, 'snapshot_chunks'),
        identical: sameState(docWith(fixture.updates, COMPACTION_UPDATE_COUNT * 2 + 1), second),
      }
    })

    expect(result.failed).toBe(false)
    expect(result.logBetween).toBe(COMPACTION_UPDATE_COUNT + 1)
    expect(result.load).toEqual({ ok: true, quarantined: 0 })
    expect(result.compacted).toBe(true)
    expect(result.logAfter).toBe(0)
    expect(result.chunksAfter).toBeGreaterThanOrEqual(1)
    expect(result.identical).toBe(true)
  })
})
