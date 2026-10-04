/**
 * The test-only half of a board room: a handful of routes under
 * `/__test/boards/:boardId/` that let the tests do what no user flow can —
 * damage a board's stored snapshot, repair it, force a reload, make the next
 * write or read fail, put a big board into storage without a browser, and start a
 * board at an address the test chose.
 *
 * They exist only when `env.TEST_HOOKS === '1'`, which is passed to `wrangler dev`
 * by the test servers and never by a production deploy; without it the Worker does
 * not route these paths at all and they fall through to the SPA.
 *
 * Everything here reads and writes the board's storage the way the board store
 * does, so what a test corrupts is exactly what a reader would meet.
 */

import * as Y from 'yjs';

import { isValidBoardId } from '../shared/board-id';
import { snapshot as boardSnapshot } from '../shared/board-model';
import type { StickySnapshot } from '../shared/board-model';
import { BoardStore, type LoadResult, type StorageSummary } from './board-store';
import type { RoomState } from './room-state';
import { largeBoard, retroBoard } from '../../tests/fixtures/boards';

/** Every hook lives under this prefix. */
export const TEST_HOOK_PREFIX = '/__test/boards/';

/** The part of a board room the hooks need; implemented by `BoardRoom`. */
export interface HookedRoom {
  readonly store: BoardStore;
  readonly roomState: RoomState;
  readonly loadFailureTime: number | null;
  readonly lastLoadError: string;
  /** This object's SQLite storage, which is what the damage hooks write to. */
  readonly objectStorage: DurableObjectStorage;
  socketCount(): number;
  /** Whether a broken board is due for another read right now. */
  retryDue(): boolean;
  armAppendFailures(times: number): void;
  armLoadFailures(times: number): void;
  reloadBoard(): LoadResult;
  compactBoard(): boolean;
  noteCount(): number;
  applySeed(update: Uint8Array): void;
  /** Start this board, exactly as `POST /api/boards` does (story 5). */
  initialize(): Promise<'created' | 'exists'>;
  /** Tear this object down abruptly, so the next request reconstructs it. */
  abortSelf(): void;
}

/**
 * Where the original chunk 0 of a damaged snapshot is kept while it is damaged, so
 * `/repair` can put back exactly what was there. A meta row, because it is the one
 * table the board store treats as its own key/value space.
 */
const BACKUP_KEY = 'test_corrupt_snapshot_chunk_0';

export async function handleTestHook(room: HookedRoom, request: Request, pathname: string): Promise<Response> {
  const route = pathname.slice(TEST_HOOK_PREFIX.length);
  const separator = route.indexOf('/');
  if (separator < 0) return json({ error: 'malformed test hook path' }, 400);

  const boardId = route.slice(0, separator);
  const action = route.slice(separator + 1);
  if (!isValidBoardId(boardId)) return json({ error: 'invalid board id' }, 400);
  if (request.method !== methodFor(action)) {
    return json({ error: `${action} requires ${methodFor(action)}` }, 405);
  }

  switch (action) {
    case 'status':
      return json({
        board: boardId,
        state: room.roomState,
        loadFailedAt: room.loadFailureTime,
        lastLoadError: room.lastLoadError,
        sockets: room.socketCount(),
        retryDue: room.retryDue(),
        storage: room.store.summary(),
      });

    case 'board':
      // Read storage into a document of its own: this is what a brand new room
      // would show, not what this one happens to remember.
      return json(boardFromStorage(room));

    case 'reload': {
      // Asked for explicitly: read now, whatever the retry interval says.
      const load = room.reloadBoard();
      return json({ state: room.roomState, load, storage: room.store.summary() });
    }

    case 'compact':
      return json({ compacted: room.compactBoard(), storage: room.store.summary() });

    case 'corrupt-snapshot':
      return corruptSnapshot(room);

    case 'repair':
      return repairSnapshot(room);

    case 'fail-append': {
      const times = await timesFromBody(request);
      room.armAppendFailures(times);
      return json({ armed: times });
    }

    case 'fail-load': {
      const times = await timesFromBody(request);
      room.armLoadFailures(times);
      return json({ armed: times });
    }

    case 'abort':
      // Evict the object with everyone still attached: the closest a running
      // server comes to the process going away. The request itself is expected to
      // fail, which is why the answer is sent first.
      setTimeout(() => room.abortSelf(), 0);
      return json({ aborting: true });

    case 'initialize': {
      // Story 5: creation normally picks its own id, which is the whole point of a
      // link code. A test that needs a board to exist at an address it knows asks
      // here instead, through the same `initialize()` the API path calls.
      const outcome = await room.initialize();
      return json({ created: outcome === 'created', storage: room.store.summary() });
    }

    case 'seed': {
      const body = await readJsonBody(request);
      const kind = body.kind === 'retro' ? 'retro' : 'large';
      const notes = typeof body.notes === 'number' ? body.notes : undefined;
      return seed(room, kind, notes);
    }

    default:
      return json({ error: `unknown test hook ${action}` }, 404);
  }
}

function methodFor(action: string): 'GET' | 'POST' {
  return action === 'status' || action === 'board' ? 'GET' : 'POST';
}

/**
 * Damage the stored snapshot: keep a copy of chunk 0, then write noise over it.
 * A board whose snapshot cannot be decoded must never open as an empty board.
 */
function corruptSnapshot(room: HookedRoom): Response {
  const sql = room.objectStorage.sql;
  const chunks = sql.exec<{ idx: number; data: ArrayBuffer }>('SELECT idx, data FROM snapshot_chunks ORDER BY idx ASC').toArray();
  if (chunks.length === 0) return json({ error: 'this board has no snapshot yet; change something or compact first' }, 409);

  const first = chunks[0]!;
  const original = new Uint8Array(first.data);
  sql.exec('INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)', BACKUP_KEY, toBase64(original));

  // Noise, not a truncation: a truncated *snapshot* is still valid-looking bytes
  // to SQLite and would decode into a partial document. The point of the test is
  // that unreadable content stops the load.
  // Noise with a header that cannot be an update: five 0xFF bytes make the first
  // varuint run off the end of the buffer. The rest is filler, so the row is the
  // size a real chunk was.
  const noise = new Uint8Array(original.byteLength);
  for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 37 + 11) % 251;
  noise[0] = 0xff;
  noise[1] = 0xff;
  noise[2] = 0xff;
  noise[3] = 0xff;
  noise[4] = 0xff;
  room.objectStorage.transactionSync(() => {
    sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', noise.buffer, first.idx);
  });

  return json({ corrupted: true, chunk: first.idx, bytes: original.byteLength, storage: room.store.summary() });
}

/** Put the snapshot back, byte for byte, and forget the backup. */
function repairSnapshot(room: HookedRoom): Response {
  const sql = room.objectStorage.sql;
  const rows = sql.exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', BACKUP_KEY).toArray();
  const backup = rows[0]?.value;
  if (backup === undefined) return json({ error: 'nothing was damaged by this hook' }, 409);

  const original = fromBase64(backup);
  room.objectStorage.transactionSync(() => {
    sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', toArrayBuffer(original));
    sql.exec('DELETE FROM storage_meta WHERE key = ?', BACKUP_KEY);
  });
  return json({ repaired: true, bytes: original.byteLength, storage: room.store.summary() });
}

/**
 * Put a prepared board into this board's storage: build it in a document of its
 * own, hand it to the room as one change (so it is written and broadcast like any
 * other), then compact, so what a reader faces is a chunked snapshot rather than
 * one enormous log row.
 */
function seed(room: HookedRoom, kind: 'retro' | 'large', notes: number | undefined): Response {
  const scratch = new Y.Doc();
  const built = kind === 'retro' ? retroBoard(scratch) : largeBoard(scratch, notes);
  room.applySeed(Y.encodeStateAsUpdate(scratch));
  const compacted = room.compactBoard();
  return json({
    seeded: kind,
    notes: room.noteCount(),
    created: built,
    compacted,
    storage: room.store.summary(),
  });
}

/** The board as its storage holds it right now. */
function boardFromStorage(room: HookedRoom): {
  state: RoomState;
  load: LoadResult;
  notes: readonly StickySnapshot[];
  storage: StorageSummary;
} {
  const doc = new Y.Doc();
  const store = new BoardStore(room.objectStorage);
  store.migrate();
  const load = store.load(doc);
  return { state: room.roomState, notes: boardSnapshot(doc), storage: store.summary(), load };
}

async function timesFromBody(request: Request): Promise<number> {
  const body = await readJsonBody(request);
  const times = typeof body.times === 'number' ? Math.floor(body.times) : 1;
  return Math.max(0, Math.min(times, 1000));
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Base64 in 8 KB slices: a snapshot chunk is far too big for one string spread. */
function toBase64(bytes: Uint8Array): string {
  let out = '';
  const slice = 8192;
  for (let offset = 0; offset < bytes.byteLength; offset += slice) {
    out += String.fromCharCode(...bytes.subarray(offset, offset + slice));
  }
  return btoa(out);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
