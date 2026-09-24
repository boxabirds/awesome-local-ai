/**
 * Story 4 · test-only hooks (design "Test hooks and failure injection").
 * Story 5 adds a third, for the legacy-board fixture.
 *
 * These routes exist so an end-to-end test can put a board into a state no
 * UI action can produce — a snapshot that cannot be decoded, or data written
 * before the creation marker existed — and then put it back:
 *
 *   POST /__test/boards/:id/corrupt-snapshot
 *   POST /__test/boards/:id/repair-snapshot
 *   POST /__test/boards/:id/seed-legacy
 *
 * They are registered **only** when `TEST_HOOKS=1` in the worker environment,
 * which is set in the e2e wrangler environment and nowhere else; production
 * and the default dev environment serve the SPA instead, so the routes do not
 * exist there. Corruption saves the original chunk 0 in the object's KV storage
 * first, so repair is an exact restore rather than a rebuild.
 *
 * Everything here is pure with respect to Cloudflare's types (the two stores
 * are structural), which keeps the file typecheckable from both tsconfigs.
 */

/** Prefix of every test-only route. */
export const TEST_PATH_PREFIX = '/__test/boards/';

/** KV key under which the pre-corruption copy of chunk 0 is kept. */
export const ORIGINAL_CHUNK_KEY = '__test/original-chunk0';

export type TestHookAction = 'corrupt-snapshot' | 'repair-snapshot' | 'seed-legacy';

export interface TestHookRequest {
  boardId: string;
  action: TestHookAction;
}

/** The same 22-character rule the room path uses: no probing arbitrary ids. */
const BOARD_ID_PATTERN = /^[a-zA-Z0-9_-]{22}(?:[a-zA-Z0-9_-]{2}==)?$/;

/** Parse `/__test/boards/<id>/<action>`; `null` for anything else. */
export function parseTestHook(pathname: string): TestHookRequest | null {
  if (!pathname.startsWith(TEST_PATH_PREFIX)) return null;
  const rest = pathname.slice(TEST_PATH_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const boardId = decodeURIComponent(rest.slice(0, slash));
  const action = rest.slice(slash + 1);
  if (
    action !== 'corrupt-snapshot' &&
    action !== 'repair-snapshot' &&
    action !== 'seed-legacy'
  ) {
    return null;
  }
  if (!BOARD_ID_PATTERN.test(boardId)) return null;
  return { boardId, action };
}

/** True when the environment opts into the routes (`TEST_HOOKS=1`). */
export function testHooksEnabled(env: Record<string, unknown> | undefined): boolean {
  return env?.['TEST_HOOKS'] === '1';
}

/** The bit of `DurableObjectStorage` these hooks need. */
export interface KvLike {
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | undefined>;
  put(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<boolean>;
}

/** The bit of `SqlStorage` these hooks need. */
export interface SqlRunnerLike {
  exec(query: string, ...bindings: unknown[]): {
    toArray(): Array<Record<string, unknown>>;
  };
}

/** Result of a hook call, mirrored into the JSON response. */
export interface HookResult {
  ok: boolean;
  detail: string;
}

/** A BLOB column, whichever shape the driver hands it back. */
function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) {
    return value.byteLength > 0 ? new Uint8Array(value) : null;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return view.byteLength > 0
      ? new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
      : null;
  }
  return null;
}

/**
 * Make chunk 0 unreadable. The bytes are replaced by a deterministic
 * pseudo-random pattern of the same length: `Y.applyUpdate` rejects it, and
 * because only the snapshot is damaged, the room takes its honest
 * "could not load" path rather than serving a partial board.
 */
export async function corruptSnapshot(
  kv: KvLike,
  sql: SqlRunnerLike,
): Promise<HookResult> {
  const rows = sql.exec(`SELECT idx, data FROM snapshot_chunks ORDER BY idx`).toArray();
  if (rows.length === 0) return { ok: false, detail: 'no snapshot to corrupt' };

  const original = toBytes(rows[0]['data']);
  if (original === null) return { ok: false, detail: 'chunk 0 missing' };
  await kv.put(ORIGINAL_CHUNK_KEY, original);

  const garbage = new Uint8Array(original.byteLength);
  for (let i = 0; i < garbage.length; i += 1) {
    // A non-zero, non-decodable pattern; the first bytes are the giveaway that
    // this is not a Yjs update (length prefixes cannot be this large).
    garbage[i] = (i * 37 + 251) & 0xff;
  }
  sql.exec(`UPDATE snapshot_chunks SET data = ? WHERE idx = ?`, garbage.buffer, rows[0]['idx']);
  return { ok: true, detail: `corrupted chunk 0 of ${rows.length}` };
}

/**
 * Write a *legacy* board: real update rows in the log, and deliberately **no**
 * `created_at` marker in `storage_meta` (PRD share.legacy_boards, e2e TC-31).
 *
 * That shape is what a board written before story 5 looks like, and it is the
 * case the existence rule must not break: the marker cannot be the only proof
 * of existence, so seeding without it is the only honest way to test the rule.
 * The `updates` table is created if it is missing (a test fixture, not a
 * production path — the Worker never creates tables for an unknown id), the
 * bytes are genuine Yjs updates built by `tests/fixtures/boards.ts`, and
 * `storage_meta` is left alone either way.
 */
export function seedLegacy(sql: SqlRunnerLike, updates: Uint8Array[]): HookResult {
  if (updates.length === 0) return { ok: false, detail: 'no updates to seed' };
  try {
    sql.exec(
      `CREATE TABLE IF NOT EXISTS updates
       (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)`,
    );
    for (const update of updates) {
      sql.exec(
        `INSERT INTO updates (data, bytes) VALUES (?, ?)`,
        update.buffer.slice(update.byteOffset, update.byteOffset + update.byteLength),
        update.byteLength,
      );
    }
    const rows = sql.exec(`SELECT COUNT(*) AS cnt FROM updates`).toArray()[0];
    return { ok: true, detail: `seeded ${rows?.['cnt'] ?? 0} update rows, no created_at` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Decode a seed body (`{"updates": [base64, …]}`) into byte arrays. Anything
 * that is not a decodable update is dropped, so a malformed body cannot write
 * junk the room would then quarantine on load.
 */
export function decodeSeed(body: { updates?: unknown }): Uint8Array[] {
  if (!Array.isArray(body.updates)) return [];
  const decoded: Uint8Array[] = [];
  for (const item of body.updates) {
    if (typeof item !== 'string') continue;
    try {
      const binary = atob(item);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      if (bytes.byteLength > 0) decoded.push(bytes);
    } catch {
      // Not base64: skip it.
    }
  }
  return decoded;
}

/** Restore the saved chunk 0; the next load reads the board again. */
export async function repairSnapshot(
  kv: KvLike,
  sql: SqlRunnerLike,
): Promise<HookResult> {
  const saved = toBytes(await kv.get(ORIGINAL_CHUNK_KEY, 'arrayBuffer'));
  if (saved === null) return { ok: false, detail: 'nothing was corrupted' };
  const rows = sql.exec(`SELECT idx FROM snapshot_chunks ORDER BY idx`).toArray();
  if (rows.length === 0) return { ok: false, detail: 'snapshot rows are gone' };

  sql.exec(
    `UPDATE snapshot_chunks SET data = ? WHERE idx = ?`,
    saved,
    rows[0]['idx'],
  );
  await kv.delete(ORIGINAL_CHUNK_KEY);
  return { ok: true, detail: `restored chunk 0 of ${rows.length}` };
}
