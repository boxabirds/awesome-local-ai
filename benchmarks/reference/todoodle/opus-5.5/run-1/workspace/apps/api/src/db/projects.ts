import { MAX_PROJECTS_PER_WORKSPACE } from '@todoodle/shared/limits';
import type { Project, UpdateProjectInput } from '@todoodle/shared/schemas';
import type { MutationResult } from '@todoodle/shared/types';
import type { DestinationState } from '../lib/moveRules.ts';

// Story 7: projects. Every statement is scoped to the workspace; nothing ever hard-deletes a project.

/** A row of the `projects` table (migrations/0003_projects.sql). */
export type ProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  sort_order: number;
  version: number;
  created_at: string;
  updated_at: string;
  deleted: number;
  deleted_at: string | null;
  delete_batch_id: string | null;
};

/** Maps a stored row to the public Project shape. Only whitelisted fields are copied. */
export function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    // Only palette keys are ever written (the zod schemas guard every insert and update).
    color: row.color as Project['color'],
    sortOrder: Number(row.sort_order),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Active projects of a workspace in creation order (sort_order, then created_at, then id). */
export async function listProjects(db: D1Database, workspaceId: string): Promise<ProjectRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM projects WHERE workspace_id = ? AND deleted = 0 ORDER BY sort_order, created_at, id')
    .bind(workspaceId)
    .all<ProjectRow>();
  return results;
}

export type InsertProjectResult =
  | { status: 'created'; project: ProjectRow }
  | { status: 'replayed'; project: ProjectRow }
  | { status: 'gone' }
  | { status: 'conflict' }
  | { status: 'limit' };

/**
 * Idempotent create keyed on the client-generated id, in one statement: the row is inserted only while
 * the workspace has fewer than MAX_PROJECTS_PER_WORKSPACE active projects, at sort_order = MAX + 1
 * (creation order; deleted projects keep their slot so a restore comes back in place).
 *
 * Nothing inserted: the id exists here (replayed, stored values win; or gone when soft-deleted), exists in
 * another workspace (conflict), or is unused, which means the limit stopped it. The limit never applies to a
 * replay, because the replay is classified from the existing row.
 */
export async function insertProjectIdempotent(
  db: D1Database,
  input: { id: string; workspaceId: string; name: string; color: string },
): Promise<InsertProjectResult> {
  const inserted = await db
    .prepare(
      `INSERT INTO projects (id, workspace_id, name, color, sort_order)
       SELECT ?1, ?2, ?3, ?4, COALESCE((SELECT MAX(sort_order) FROM projects WHERE workspace_id = ?2), 0) + 1
       WHERE (SELECT COUNT(*) FROM projects WHERE workspace_id = ?2 AND deleted = 0) < ?5
       ON CONFLICT(id) DO NOTHING RETURNING *`,
    )
    .bind(input.id, input.workspaceId, input.name, input.color, MAX_PROJECTS_PER_WORKSPACE)
    .first<ProjectRow>();
  if (inserted) return { status: 'created', project: inserted };

  const existing = await getProjectById(db, input.id);
  if (!existing) return { status: 'limit' };
  if (existing.workspace_id !== input.workspaceId) return { status: 'conflict' };
  if (existing.deleted !== 0) return { status: 'gone' };
  return { status: 'replayed', project: existing };
}

function getProjectById(db: D1Database, projectId: string): Promise<ProjectRow | null> {
  return db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<ProjectRow>();
}

/** The project in this workspace whatever its state; null when it does not exist here (or is another workspace's). */
export function getProject(db: D1Database, workspaceId: string, projectId: string): Promise<ProjectRow | null> {
  return db.prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ?').bind(projectId, workspaceId).first<ProjectRow>();
}

/**
 * Rename and/or recolour. Missing here: missing (404); soft-deleted: gone (410); nothing different: noop (no
 * version bump, no broadcast); otherwise version + 1 and updated_at = now. Last write wins.
 */
export async function updateProject(
  db: D1Database,
  workspaceId: string,
  projectId: string,
  patch: UpdateProjectInput,
  now: string,
): Promise<MutationResult<Project>> {
  const current = await getProject(db, workspaceId, projectId);
  if (!current) return { kind: 'missing' };
  if (current.deleted !== 0) return { kind: 'gone' };
  const name = patch.name ?? current.name;
  const color = patch.color ?? current.color;
  if (name === current.name && color === current.color) return { kind: 'noop', entity: rowToProject(current) };
  const row = await db
    .prepare(
      `UPDATE projects SET name = ?1, color = ?2, version = version + 1, updated_at = ?3
       WHERE id = ?4 AND workspace_id = ?5 AND deleted = 0 RETURNING *`,
    )
    .bind(name, color, now, projectId, workspaceId)
    .first<ProjectRow>();
  return row ? { kind: 'changed', entity: rowToProject(row) } : { kind: 'gone' };
}

export type ProjectBatchResult = { project: ProjectRow; taskIds: string[] };

/**
 * Deletes an active project and all its non-deleted tasks (open and completed) in ONE D1 batch (one
 * transaction: a failure applies nothing). Both rows get deleted_at = now, delete_batch_id = batchId and
 * version + 1. Tasks deleted on their own earlier are untouched (they keep delete_batch_id NULL), so undo can
 * never resurrect them. The task UPDATE runs first and only while the project is still active, so a concurrent
 * delete can't tag tasks with a batch whose project update then matches nothing. Null: the project was not
 * active any more.
 */
export async function deleteProjectBatch(
  db: D1Database,
  workspaceId: string,
  projectId: string,
  batchId: string,
  now: string,
): Promise<ProjectBatchResult | null> {
  const [tasks, projects] = await db.batch([
    db
      .prepare(
        `UPDATE tasks SET deleted = 1, deleted_at = ?1, delete_batch_id = ?2, version = version + 1, updated_at = ?1
         WHERE workspace_id = ?3 AND project_id = ?4 AND deleted = 0
           AND EXISTS (SELECT 1 FROM projects WHERE id = ?4 AND workspace_id = ?3 AND deleted = 0)
         RETURNING id`,
      )
      .bind(now, batchId, workspaceId, projectId),
    db
      .prepare(
        `UPDATE projects SET deleted = 1, deleted_at = ?1, delete_batch_id = ?2, version = version + 1, updated_at = ?1
         WHERE id = ?3 AND workspace_id = ?4 AND deleted = 0 RETURNING *`,
      )
      .bind(now, batchId, projectId, workspaceId),
  ]);
  const project = (projects?.results as ProjectRow[] | undefined)?.[0];
  if (!project) return null;
  return { project, taskIds: ((tasks?.results ?? []) as { id: string }[]).map((row) => row.id) };
}

/**
 * Undo of deleteProjectBatch, in ONE D1 batch: restores the project and exactly the tasks tagged with
 * batchId (never a task deleted on its own, whose delete_batch_id is NULL). Clears deleted_at and
 * delete_batch_id and bumps versions; completed_at is kept, so completed tasks come back completed. Null: the
 * project is no longer deleted by this batch.
 */
export async function restoreProjectBatch(
  db: D1Database,
  workspaceId: string,
  projectId: string,
  batchId: string,
  now: string,
): Promise<ProjectBatchResult | null> {
  const [tasks, projects] = await db.batch([
    db
      .prepare(
        `UPDATE tasks SET deleted = 0, deleted_at = NULL, delete_batch_id = NULL, version = version + 1, updated_at = ?1
         WHERE delete_batch_id = ?2 AND project_id = ?3 AND workspace_id = ?4
           AND EXISTS (SELECT 1 FROM projects WHERE id = ?3 AND workspace_id = ?4 AND deleted = 1 AND delete_batch_id = ?2)
         RETURNING id`,
      )
      .bind(now, batchId, projectId, workspaceId),
    db
      .prepare(
        `UPDATE projects SET deleted = 0, deleted_at = NULL, delete_batch_id = NULL, version = version + 1, updated_at = ?1
         WHERE id = ?2 AND workspace_id = ?3 AND deleted = 1 AND delete_batch_id = ?4 RETURNING *`,
      )
      .bind(now, projectId, workspaceId, batchId),
  ]);
  const project = (projects?.results as ProjectRow[] | undefined)?.[0];
  if (!project) return null;
  return { project, taskIds: ((tasks?.results ?? []) as { id: string }[]).map((row) => row.id) };
}

/** A project's state in this workspace: active, soft-deleted, or missing (unknown id or another workspace's). */
export async function getActiveProjectForWorkspace(db: D1Database, workspaceId: string, projectId: string): Promise<DestinationState> {
  const row = await db
    .prepare('SELECT deleted FROM projects WHERE id = ? AND workspace_id = ?')
    .bind(projectId, workspaceId)
    .first<{ deleted: number }>();
  if (!row) return 'missing';
  return row.deleted === 0 ? 'active' : 'deleted';
}
