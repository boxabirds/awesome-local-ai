import type { RememberedPublic } from '@todoodle/shared/schemas';
import { type WorkspaceSecretRow, getWorkspacesByIds } from '../db/workspaces.ts';
import type { RememberedEntry } from './cookie.ts';
import { hashSecret, hashesEqual } from './crypto.ts';

const MS_PER_SECOND = 1000;

/**
 * The public view of one remembered entry: exactly id, name, lastOpenedAt and available. The secret is
 * never copied. An unavailable entry has name null, so the response never confirms that an id exists.
 */
export function toPublic(entry: RememberedEntry, row: Pick<WorkspaceSecretRow, 'name'> | null): RememberedPublic {
  return {
    id: entry.id,
    name: row ? row.name : null,
    lastOpenedAt: new Date(entry.t * MS_PER_SECOND).toISOString(),
    available: row !== null,
  };
}

/**
 * Each entry with its live row when the row exists (not deleted) AND sha256(entry.s) matches its
 * secret_hash (constant-time); otherwise null. One D1 query, run concurrently with the hashing.
 */
export async function verifyRemembered(
  db: D1Database,
  entries: RememberedEntry[],
): Promise<Array<{ entry: RememberedEntry; row: WorkspaceSecretRow | null }>> {
  const [rows, hashes] = await Promise.all([
    getWorkspacesByIds(
      db,
      entries.map((entry) => entry.id),
    ),
    Promise.all(entries.map((entry) => hashSecret(entry.s))),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return entries.map((entry, i) => {
    const row = byId.get(entry.id);
    return { entry, row: row && hashesEqual(row.secret_hash, hashes[i] ?? '') ? row : null };
  });
}

/** This browser's remembered workspaces in cookie order (most recent first), with verified availability. */
export async function listRemembered(db: D1Database, entries: RememberedEntry[]): Promise<RememberedPublic[]> {
  const verified = await verifyRemembered(db, entries);
  return verified.map(({ entry, row }) => toPublic(entry, row));
}
