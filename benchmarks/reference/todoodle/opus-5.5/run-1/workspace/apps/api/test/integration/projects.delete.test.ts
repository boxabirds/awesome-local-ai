import { SELF } from 'cloudflare:test';
import { LiveEvent } from '@todoodle/shared/events';
import { CountsSchema, DeleteProjectResponse, RestoreProjectResponse } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import type { TaskRow } from '../../src/db/tasks.ts';
import { url } from '../support/http.ts';
import { connectLive } from '../support/live.ts';
import {
  createProject,
  createTaskIn,
  deleteProject,
  markCompletedAt,
  markDeletedAlone,
  newProjectId,
  projectRow,
  restoreProject,
  seedProjects,
} from '../support/projects.ts';
import { getCounts, member, taskRow } from '../support/tasks.ts';
import { JSON_CLIENT } from '../support/workspaces.ts';

// Story 7, projects.api_delete_restore: atomic delete and exact-set batch restore through SELF.fetch with real
// D1 (batch atomicity and the batch predicate are D1 behaviours) and a real WorkspaceRoom.

const COMPLETED_AT = ['2026-09-24T17:30:00.000Z', '2026-09-25T08:00:00.000Z'];

/** A project with 3 open and 2 completed tasks, plus 2 Inbox tasks and another project's task. */
async function projectWithTasks() {
  const { browser, id } = await member();
  const projectId = await createProject(browser, id, 'Work');
  const other = await createProject(browser, id, 'Home');
  const open = [];
  for (const name of ['Draft Q3 plan', 'Email Sam re: invoice #4411', 'Book room']) open.push(await createTaskIn(browser, id, projectId, name));
  const completed = [];
  for (const [index, name] of ['File expenses', 'Review PR'].entries()) {
    const taskId = await createTaskIn(browser, id, projectId, name);
    await markCompletedAt(taskId, COMPLETED_AT[index]!);
    completed.push(taskId);
  }
  const inbox = [await createTaskIn(browser, id, null, 'Buy milk'), await createTaskIn(browser, id, null, 'Call Mum 📞')];
  const otherTask = await createTaskIn(browser, id, other, 'Fix the bike light');
  return { browser, id, projectId, other, open, completed, inbox, otherTask };
}

async function rows(ids: string[]): Promise<TaskRow[]> {
  return Promise.all(ids.map(async (taskId) => (await taskRow(taskId))!));
}

function sql(statement: string) {
  return SELF.fetch(url('/test/sql'), { method: 'POST', headers: JSON_CLIENT, body: JSON.stringify({ sql: statement }) });
}

describe('projects.api_delete_restore: DELETE /projects/:pid', () => {
  it('TC-24 an empty project: 200 {batchId, deletedTaskCount: 0}; project deleted with that batch', async () => {
    const { browser, id } = await member();
    const projectId = await createProject(browser, id, 'Work');
    const res = await deleteProject(browser, id, projectId);
    expect(res.status).toBe(200);
    const body = DeleteProjectResponse.parse(await res.json());
    expect(body.deletedTaskCount).toBe(0);
    expect(await projectRow(projectId)).toMatchObject({ deleted: 1, delete_batch_id: body.batchId, version: 2 });
    expect((await projectRow(projectId))?.deleted_at).toEqual(expect.any(String));
  });

  it('TC-25 3 open + 2 completed: all 5 deleted with one batch and version +1; Inbox and other projects untouched; events; counts entry gone', async () => {
    const fx = await projectWithTasks();
    const socket = await connectLive(fx.browser, fx.id);
    const mine = [...fx.open, ...fx.completed];
    const before = await rows(mine);
    const untouchedBefore = await rows([...fx.inbox, fx.otherTask]);

    const res = await deleteProject(fx.browser, fx.id, fx.projectId);
    expect(res.status).toBe(200);
    const { batchId, deletedTaskCount } = DeleteProjectResponse.parse(await res.json());
    expect(deletedTaskCount).toBe(5);

    for (const [index, row] of (await rows(mine)).entries()) {
      expect(row).toMatchObject({ deleted: 1, delete_batch_id: batchId, version: before[index]!.version + 1, completed_at: before[index]!.completed_at });
    }
    expect(await rows([...fx.inbox, fx.otherTask])).toEqual(untouchedBefore);

    const frames = (await socket.waitForFrames(2)).map((frame) => LiveEvent.parse(JSON.parse(frame)));
    socket.close();
    expect(frames[0]).toMatchObject({ type: 'project.deleted', version: 2, entity: { id: fx.projectId, batchId } });
    expect(frames[1]).toMatchObject({ type: 'tasks.bulk', entity: { deleted: true } });
    expect((frames[1]!.entity as { ids: string[] }).ids.toSorted()).toEqual(mine.toSorted());

    const counts = CountsSchema.parse(await (await getCounts(fx.browser, fx.id)).json());
    expect(counts.projects[fx.projectId]).toBeUndefined();
    expect(counts.projects[fx.other]).toEqual({ open: 1, total: 1 });
    expect(counts.inbox).toBe(2);
  });

  it('TC-26 a task deleted on its own earlier keeps delete_batch_id NULL and its original deleted_at', async () => {
    const fx = await projectWithTasks();
    const alone = await createTaskIn(fx.browser, fx.id, fx.projectId, 'Old ticket');
    await markDeletedAlone(alone, '2026-09-20T09:00:00.000Z');
    const before = await taskRow(alone);
    const res = await deleteProject(fx.browser, fx.id, fx.projectId);
    expect(DeleteProjectResponse.parse(await res.json()).deletedTaskCount).toBe(5);
    expect(await taskRow(alone)).toEqual(before);
    expect(before).toMatchObject({ deleted: 1, delete_batch_id: null, deleted_at: '2026-09-20T09:00:00.000Z' });
  });

  it('TC-27 an already deleted project -> 410 gone; delete_batch_id unchanged', async () => {
    const { browser, id } = await member();
    const projectId = await createProject(browser, id, 'Work');
    const { batchId } = DeleteProjectResponse.parse(await (await deleteProject(browser, id, projectId)).json());
    const res = await deleteProject(browser, id, projectId);
    expect(res.status).toBe(410);
    expect(await projectRow(projectId)).toMatchObject({ delete_batch_id: batchId, version: 2 });
  });

  it('TC-28 a nonexistent project and another workspace\'s project -> 404; nothing changes in either workspace', async () => {
    const a = await member();
    const b = await projectWithTasks();
    const theirs = await rows([...b.open, ...b.completed]);
    const theirProject = await projectRow(b.projectId);
    for (const projectId of [newProjectId(), b.projectId, 'nope']) {
      const res = await deleteProject(a.browser, a.id, projectId);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'not_found' });
    }
    expect(await projectRow(b.projectId)).toEqual(theirProject);
    expect(await rows([...b.open, ...b.completed])).toEqual(theirs);
  });

  it('TC-29 the batch is atomic: a trigger aborting the project UPDATE -> 500 and the 3 tasks stay undeleted', async () => {
    const { browser, id } = await member();
    const projectId = await createProject(browser, id, 'Work');
    const tasks = [];
    for (const name of ['One', 'Two', 'Three']) tasks.push(await createTaskIn(browser, id, projectId, name));
    const before = await rows(tasks);
    expect(
      (await sql("CREATE TRIGGER abort_project_delete BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'aborted by test'); END")).status,
    ).toBe(200);
    try {
      const res = await deleteProject(browser, id, projectId);
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ error: 'internal' });
      expect(await rows(tasks)).toEqual(before);
      expect(await projectRow(projectId)).toMatchObject({ deleted: 0, delete_batch_id: null, version: 1 });
    } finally {
      await sql('DROP TRIGGER IF EXISTS abort_project_delete');
    }
  });
});

describe('projects.api_delete_restore: POST /projects/:pid/restore', () => {
  it('TC-30 the matching batch: project and 5 tasks back (version +1, completed_at kept), counts back, events', async () => {
    const fx = await projectWithTasks();
    const mine = [...fx.open, ...fx.completed];
    const countsBefore = CountsSchema.parse(await (await getCounts(fx.browser, fx.id)).json());
    const { batchId } = DeleteProjectResponse.parse(await (await deleteProject(fx.browser, fx.id, fx.projectId)).json());
    const deleted = await rows(mine);
    const socket = await connectLive(fx.browser, fx.id);

    const res = await restoreProject(fx.browser, fx.id, fx.projectId, batchId);
    expect(res.status).toBe(200);
    const body = RestoreProjectResponse.parse(await res.json());
    expect(body).toMatchObject({ restoredTaskCount: 5, project: { id: fx.projectId, name: 'Work', version: 3 } });

    expect(await projectRow(fx.projectId)).toMatchObject({ deleted: 0, deleted_at: null, delete_batch_id: null, version: 3 });
    for (const [index, row] of (await rows(mine)).entries()) {
      expect(row).toMatchObject({
        deleted: 0,
        deleted_at: null,
        delete_batch_id: null,
        version: deleted[index]!.version + 1,
        completed_at: deleted[index]!.completed_at,
      });
    }
    expect((await rows(fx.completed)).map((r) => r.completed_at)).toEqual(COMPLETED_AT);
    expect(CountsSchema.parse(await (await getCounts(fx.browser, fx.id)).json())).toEqual(countsBefore);

    const frames = (await socket.waitForFrames(2)).map((frame) => LiveEvent.parse(JSON.parse(frame)));
    socket.close();
    expect(frames[0]).toMatchObject({ type: 'project.restored', version: 3, entity: { id: fx.projectId, name: 'Work' } });
    expect(frames[1]).toMatchObject({ type: 'tasks.bulk', entity: { deleted: false } });
    expect((frames[1]!.entity as { ids: string[] }).ids.toSorted()).toEqual(mine.toSorted());
  });

  it('TC-31 a task deleted on its own before the project delete stays deleted after the restore', async () => {
    const fx = await projectWithTasks();
    const alone = await createTaskIn(fx.browser, fx.id, fx.projectId, 'Old ticket');
    await markDeletedAlone(alone);
    const before = await taskRow(alone);
    const { batchId } = DeleteProjectResponse.parse(await (await deleteProject(fx.browser, fx.id, fx.projectId)).json());
    const res = await restoreProject(fx.browser, fx.id, fx.projectId, batchId);
    expect(RestoreProjectResponse.parse(await res.json()).restoredTaskCount).toBe(5);
    expect(await taskRow(alone)).toEqual(before);
  });

  it('TC-32 a wrong batchId -> 409 batch_mismatch; nothing changes', async () => {
    const fx = await projectWithTasks();
    await deleteProject(fx.browser, fx.id, fx.projectId);
    const project = await projectRow(fx.projectId);
    const tasks = await rows([...fx.open, ...fx.completed]);
    const res = await restoreProject(fx.browser, fx.id, fx.projectId, newProjectId());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'batch_mismatch' });
    expect(await projectRow(fx.projectId)).toEqual(project);
    expect(await rows([...fx.open, ...fx.completed])).toEqual(tasks);
  });

  it('TC-33 an active project -> 409 not_deleted; nothing changes', async () => {
    const fx = await projectWithTasks();
    const project = await projectRow(fx.projectId);
    const res = await restoreProject(fx.browser, fx.id, fx.projectId, newProjectId());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_deleted' });
    expect(await projectRow(fx.projectId)).toEqual(project);
  });

  it("TC-34 a nonexistent project and another workspace's project -> 404", async () => {
    const a = await member();
    const b = await projectWithTasks();
    const { batchId } = DeleteProjectResponse.parse(await (await deleteProject(b.browser, b.id, b.projectId)).json());
    for (const projectId of [newProjectId(), b.projectId]) {
      expect((await restoreProject(a.browser, a.id, projectId, batchId)).status).toBe(404);
    }
    expect(await projectRow(b.projectId)).toMatchObject({ deleted: 1, delete_batch_id: batchId });
  });

  it('a missing or malformed batchId -> 400 validation', async () => {
    const fx = await projectWithTasks();
    await deleteProject(fx.browser, fx.id, fx.projectId);
    for (const batchId of ['', 'not-hex', 'ABCDEF0123456789ABCDEF0123456789']) {
      expect((await restoreProject(fx.browser, fx.id, fx.projectId, batchId)).status).toBe(400);
    }
    const res = await fx.browser.fetch(`/api/w/${fx.id}/projects/${fx.projectId}/restore`, { method: 'POST', headers: JSON_CLIENT, body: '{}' });
    expect(res.status).toBe(400);
  });

  it('TC-35 delete B1, restore B1, delete B2: restoring with B1 -> 409 batch_mismatch, with B2 -> 200', async () => {
    const fx = await projectWithTasks();
    const b1 = DeleteProjectResponse.parse(await (await deleteProject(fx.browser, fx.id, fx.projectId)).json()).batchId;
    expect((await restoreProject(fx.browser, fx.id, fx.projectId, b1)).status).toBe(200);
    const b2 = DeleteProjectResponse.parse(await (await deleteProject(fx.browser, fx.id, fx.projectId)).json()).batchId;
    expect(b2).not.toBe(b1);
    const stale = await restoreProject(fx.browser, fx.id, fx.projectId, b1);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: 'batch_mismatch' });
    const res = await restoreProject(fx.browser, fx.id, fx.projectId, b2);
    expect(res.status).toBe(200);
    expect(RestoreProjectResponse.parse(await res.json()).restoredTaskCount).toBe(5);
  });

  it('the server enforces no undo window: a later restore with the right batch still works', async () => {
    const { browser, id } = await member();
    await seedProjects(id, 3);
    const projectId = await createProject(browser, id, 'Work');
    const { batchId } = DeleteProjectResponse.parse(await (await deleteProject(browser, id, projectId)).json());
    // Long after any UI window: the server still honours the batch.
    expect((await restoreProject(browser, id, projectId, batchId)).status).toBe(200);
  });
});
