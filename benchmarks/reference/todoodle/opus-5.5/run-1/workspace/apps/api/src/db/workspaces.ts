/** A row of the `workspaces` table (migrations/0001_workspaces.sql). */
export type WorkspaceRow = {
  id: string;
  secret_hash: string;
  name: string;
  version: number;
  created_at: string;
  updated_at: string;
  deleted: number;
  deleted_at: string | null;
};

export async function insertWorkspace(db: D1Database, secretHash: string, name: string): Promise<WorkspaceRow> {
  const row = await db
    .prepare('INSERT INTO workspaces (secret_hash, name) VALUES (?, ?) RETURNING *')
    .bind(secretHash, name)
    .first<WorkspaceRow>();
  if (!row) throw new Error('insertWorkspace returned no row');
  return row;
}

/** Uses the UNIQUE index on secret_hash. Deleted workspaces are never found. */
export function findActiveBySecretHash(db: D1Database, secretHash: string): Promise<WorkspaceRow | null> {
  return db.prepare('SELECT * FROM workspaces WHERE secret_hash = ? AND deleted = 0').bind(secretHash).first<WorkspaceRow>();
}

export function findActiveById(db: D1Database, id: string): Promise<WorkspaceRow | null> {
  return db.prepare('SELECT * FROM workspaces WHERE id = ? AND deleted = 0').bind(id).first<WorkspaceRow>();
}

/** Sets the name and bumps version and updated_at. Null when the workspace is missing or deleted. */
export function renameWorkspace(db: D1Database, id: string, name: string): Promise<WorkspaceRow | null> {
  return db
    .prepare(
      "UPDATE workspaces SET name = ?, version = version + 1, updated_at = datetime('now') WHERE id = ? AND deleted = 0 RETURNING *",
    )
    .bind(name, id)
    .first<WorkspaceRow>();
}

export type WorkspaceSecretRow = Pick<WorkspaceRow, 'id' | 'name' | 'secret_hash'>;

/** One prepared statement for all ids (the remembered list is one D1 round-trip). Deleted rows are excluded. */
export async function getWorkspacesByIds(db: D1Database, ids: string[]): Promise<WorkspaceSecretRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const { results } = await db
    .prepare(`SELECT id, name, secret_hash FROM workspaces WHERE deleted = 0 AND id IN (${placeholders})`)
    .bind(...ids)
    .all<WorkspaceSecretRow>();
  return results;
}
