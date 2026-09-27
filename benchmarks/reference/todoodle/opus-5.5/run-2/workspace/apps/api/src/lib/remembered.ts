import type { RememberedPublic } from '@todoodle/shared/schemas';
import { getWorkspacesByIds, type WorkspaceNameHash } from '../db/workspaces';
import type { RememberedEntry } from './cookie';
import { hashesEqual, hashSecret } from './crypto';

/**
 * The live workspace rows whose stored hash matches this browser's secret, keyed by id. One D1
 * query; the secrets are hashed in parallel with it. Anything missing, deleted or mismatched is
 * simply absent, so callers cannot tell those cases apart.
 */
export async function verifiedRows(
  db: D1Database,
  entries: RememberedEntry[],
): Promise<Map<string, WorkspaceNameHash>> {
  const [rows, hashes] = await Promise.all([
    getWorkspacesByIds(
      db,
      entries.map((e) => e.id),
    ),
    Promise.all(entries.map((e) => hashSecret(e.s))),
  ]);
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const verified = new Map<string, WorkspaceNameHash>();
  entries.forEach((entry, i) => {
    const row = rowsById.get(entry.id);
    if (row && hashesEqual(row.secret_hash, hashes[i]!)) verified.set(entry.id, row);
  });
  return verified;
}

/** The public view of one entry. Picks exactly four keys, so the secret can never leak. */
export function toPublic(entry: RememberedEntry, row: WorkspaceNameHash | undefined): RememberedPublic {
  return {
    id: entry.id,
    name: row ? row.name : null,
    lastOpenedAt: new Date(entry.t * 1000).toISOString(),
    available: row !== undefined,
  };
}

/** This browser's remembered workspaces, most recent first, with names only for verified ones. */
export async function listRemembered(db: D1Database, entries: RememberedEntry[]): Promise<RememberedPublic[]> {
  const verified = await verifiedRows(db, entries);
  return entries.map((entry) => toPublic(entry, verified.get(entry.id)));
}
