import { DELETE_BATCH_ID_BYTES, TASKS_BULK_MAX_IDS } from '@todoodle/shared/limits';
import {
  CreateProjectInputSchema,
  type Project,
  ProjectIdSchema,
  RestoreProjectInputSchema,
  UpdateProjectInputSchema,
} from '@todoodle/shared/schemas';
import { type Context, Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import {
  deleteProjectBatch,
  getProject,
  insertProjectIdempotent,
  listProjects,
  restoreProjectBatch,
  rowToProject,
  updateProject,
} from '../db/projects.ts';
import { randomHexId } from '../lib/crypto.ts';
import { errorResponse } from '../lib/errors.ts';
import { readJson } from '../lib/json.ts';
import { broadcast } from '../live/broadcast.ts';
import { decideRestore } from '../lib/restoreRules.ts';

/** Routes under /api/w/:workspaceId/projects, mounted behind workspace-auth (c.var.workspace is verified). */
export const projectsRoutes = new Hono<AppEnv>();

type AppContext = Context<AppEnv>;

/** The project id from the path; a malformed id can't name a project, so it is a plain 404. */
export function projectIdOf(c: AppContext): string | null {
  const parsed = ProjectIdSchema.safeParse(c.req.param('projectId'));
  return parsed.success ? parsed.data : null;
}

function broadcastUpserted(c: AppContext, project: Project): void {
  broadcast(c, c.var.workspace.id, { type: 'project.upserted', entity: project, version: project.version });
}

/** GET: the workspace's active projects in creation order. */
projectsRoutes.get('/', async (c) => {
  const rows = await listProjects(c.env.DB, c.var.workspace.id);
  return c.json({ projects: rows.map(rowToProject) });
});

/**
 * Idempotent create (client-generated id): 201 created (broadcast), 200 replay (stored values win, no
 * broadcast, never limited), 410 the id names a deleted project here, 409 id_conflict (another workspace's
 * id), 409 limit_reached (MAX_PROJECTS_PER_WORKSPACE active projects already).
 */
projectsRoutes.post('/', async (c) => {
  const parsed = CreateProjectInputSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return errorResponse('validation', 400);
  const result = await insertProjectIdempotent(c.env.DB, { ...parsed.data, workspaceId: c.var.workspace.id });
  switch (result.status) {
    case 'created': {
      const project = rowToProject(result.project);
      broadcastUpserted(c, project);
      return c.json({ project }, 201);
    }
    case 'replayed':
      return c.json({ project: rowToProject(result.project) }, 200);
    case 'gone':
      return errorResponse('gone', 410);
    case 'conflict':
      return errorResponse('id_conflict', 409);
    case 'limit':
      return errorResponse('limit_reached', 409);
  }
});

/** Rename and/or recolour (strict body, at least one field). Only a real change bumps the version and broadcasts. */
projectsRoutes.patch('/:projectId', async (c) => {
  const parsed = UpdateProjectInputSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return errorResponse('validation', 400);
  const projectId = projectIdOf(c);
  if (!projectId) return errorResponse('not_found', 404);
  const result = await updateProject(c.env.DB, c.var.workspace.id, projectId, parsed.data, new Date().toISOString());
  switch (result.kind) {
    case 'missing':
      return errorResponse('not_found', 404);
    case 'gone':
      return errorResponse('gone', 410);
    case 'noop':
      return c.json({ project: result.entity });
    case 'changed':
      broadcastUpserted(c, result.entity);
      return c.json({ project: result.entity });
  }
});

/** tasks.bulk for a project delete/restore, split so no event exceeds the live size limit. None when no task moved. */
function broadcastTasksBulk(c: AppContext, ids: string[], deleted: boolean, version: number): void {
  for (let start = 0; start < ids.length; start += TASKS_BULK_MAX_IDS) {
    broadcast(c, c.var.workspace.id, { type: 'tasks.bulk', entity: { ids: ids.slice(start, start + TASKS_BULK_MAX_IDS), deleted }, version });
  }
}

/**
 * Deletes the project and every task in it (open and completed) atomically, tagged with a fresh batch id
 * that the client keeps for Undo. 404 unknown here, 410 already deleted. There is no server-side undo window:
 * a restore with the right batch id works at any time (operators can recover), the 10 s is a UI affordance.
 */
projectsRoutes.delete('/:projectId', async (c) => {
  const projectId = projectIdOf(c);
  if (!projectId) return errorResponse('not_found', 404);
  const workspaceId = c.var.workspace.id;
  const existing = await getProject(c.env.DB, workspaceId, projectId);
  if (!existing) return errorResponse('not_found', 404);
  if (existing.deleted !== 0) return errorResponse('gone', 410);
  const batchId = randomHexId(DELETE_BATCH_ID_BYTES);
  const result = await deleteProjectBatch(c.env.DB, workspaceId, projectId, batchId, new Date().toISOString());
  // Deleted concurrently between the read and the batch: nothing was written by this request.
  if (!result) return errorResponse('gone', 410);
  const { version } = result.project;
  broadcast(c, workspaceId, { type: 'project.deleted', entity: { id: projectId, batchId }, version });
  broadcastTasksBulk(c, result.taskIds, true, version);
  return c.json({ batchId, deletedTaskCount: result.taskIds.length });
});

/** Undo: restores the project and exactly the tasks its deletion (batchId) removed. */
projectsRoutes.post('/:projectId/restore', async (c) => {
  const parsed = RestoreProjectInputSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return errorResponse('validation', 400);
  const projectId = projectIdOf(c);
  if (!projectId) return errorResponse('not_found', 404);
  const workspaceId = c.var.workspace.id;
  const existing = await getProject(c.env.DB, workspaceId, projectId);
  if (!existing) return errorResponse('not_found', 404);
  const decision = decideRestore(existing, parsed.data.batchId);
  if (decision !== 'ok') return errorResponse(decision, 409);
  const result = await restoreProjectBatch(c.env.DB, workspaceId, projectId, parsed.data.batchId, new Date().toISOString());
  // Restored (or re-deleted) concurrently: this batch no longer names the project's deletion.
  if (!result) return errorResponse('batch_mismatch', 409);
  const project = rowToProject(result.project);
  broadcast(c, workspaceId, { type: 'project.restored', entity: project, version: project.version });
  broadcastTasksBulk(c, result.taskIds, false, project.version);
  return c.json({ project, restoredTaskCount: result.taskIds.length });
});
