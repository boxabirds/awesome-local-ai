import { LiveEvent } from '@todoodle/shared/events';
import { TASK_SORT_STEP } from '@todoodle/shared/limits';
import { CountsSchema, TaskListResponse, TaskResponse } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import { newTaskId } from '../fixtures/tasks.ts';
import { type LiveClient, connectLive, framesAfter } from '../support/live.ts';
import { createProject, createTaskIn, deleteProject, markCompletedAt, newProjectId } from '../support/projects.ts';
import { deleteTask, getCounts, listTasks, member, patchTask, postTask, taskRow, taskRows } from '../support/tasks.ts';

// Story 7, tasks.project_scope_api: create in a project, list per project, and move (PATCH projectId) through
// SELF.fetch with real D1 and a real WorkspaceRoom.

const NO_EVENT_WAIT_MS = 300;

async function nextEvent(socket: LiveClient): Promise<LiveEvent> {
  const [frame] = await socket.waitForFrames(1);
  socket.close();
  return LiveEvent.parse(JSON.parse(frame!));
}

async function maxSortOrder(workspaceId: string): Promise<number> {
  return Math.max(...(await taskRows(workspaceId)).map((row) => Number(row.sort_order)));
}

async function counts(browser: Parameters<typeof getCounts>[0], id: string) {
  return CountsSchema.parse(await (await getCounts(browser, id)).json());
}

/** A workspace with project P (2 tasks), Inbox tasks and another project Q. */
async function setup() {
  const { browser, id } = await member();
  const p = await createProject(browser, id, 'Work');
  const q = await createProject(browser, id, 'Woodwork');
  const inboxTask = await createTaskIn(browser, id, null, 'Buy milk');
  const pTasks = [await createTaskIn(browser, id, p, 'Draft Q3 plan'), await createTaskIn(browser, id, p, 'Book room')];
  await createTaskIn(browser, id, null, 'Call Mum 📞');
  return { browser, id, p, q, inboxTask, pTasks };
}

describe('tasks.project_scope_api: move (PATCH /tasks/:tid {projectId})', () => {
  it('TC-36 Inbox -> active P: 200; project_id P; sort_order = workspace MAX + step; version +1; task.upserted; counts', async () => {
    const fx = await setup();
    const before = (await taskRow(fx.inboxTask))!;
    const max = await maxSortOrder(fx.id);
    const countsBefore = await counts(fx.browser, fx.id);
    const socket = await connectLive(fx.browser, fx.id);

    const res = await patchTask(fx.browser, fx.id, fx.inboxTask, { projectId: fx.p });
    expect(res.status).toBe(200);
    expect(TaskResponse.parse(await res.json()).task).toMatchObject({ id: fx.inboxTask, projectId: fx.p, version: before.version + 1 });
    expect(await taskRow(fx.inboxTask)).toMatchObject({
      project_id: fx.p,
      sort_order: max + TASK_SORT_STEP,
      version: before.version + 1,
      name: before.name,
      completed_at: null,
    });
    expect(await nextEvent(socket)).toMatchObject({ type: 'task.upserted', version: before.version + 1, entity: { id: fx.inboxTask, projectId: fx.p } });

    const after = await counts(fx.browser, fx.id);
    expect(after.inbox).toBe(countsBefore.inbox - 1);
    expect(after.projects[fx.p]!.open).toBe(countsBefore.projects[fx.p]!.open + 1);
  });

  it('TC-37 P -> Inbox (null): 200; project_id NULL', async () => {
    const fx = await setup();
    const res = await patchTask(fx.browser, fx.id, fx.pTasks[0]!, { projectId: null });
    expect(res.status).toBe(200);
    expect(TaskResponse.parse(await res.json()).task.projectId).toBeNull();
    expect((await taskRow(fx.pTasks[0]!))?.project_id).toBeNull();
  });

  it('P -> another project Q moves it there', async () => {
    const fx = await setup();
    expect((await patchTask(fx.browser, fx.id, fx.pTasks[1]!, { projectId: fx.q })).status).toBe(200);
    expect((await taskRow(fx.pTasks[1]!))?.project_id).toBe(fx.q);
  });

  it('TC-38 to its current list: 200; version unchanged; no event', async () => {
    const fx = await setup();
    const socket = await connectLive(fx.browser, fx.id);
    const beforeP = (await taskRow(fx.pTasks[0]!))!;
    const beforeInbox = (await taskRow(fx.inboxTask))!;
    expect((await patchTask(fx.browser, fx.id, fx.pTasks[0]!, { projectId: fx.p })).status).toBe(200);
    expect((await patchTask(fx.browser, fx.id, fx.inboxTask, { projectId: null })).status).toBe(200);
    expect(await taskRow(fx.pTasks[0]!)).toEqual(beforeP);
    expect(await taskRow(fx.inboxTask)).toEqual(beforeInbox);
    expect(await framesAfter(socket, NO_EVENT_WAIT_MS)).toEqual([]);
    socket.close();
  });

  it('TC-39 to a soft-deleted project -> 404 project_not_found; task unchanged', async () => {
    const fx = await setup();
    expect((await deleteProject(fx.browser, fx.id, fx.q)).status).toBe(200);
    const before = await taskRow(fx.inboxTask);
    const res = await patchTask(fx.browser, fx.id, fx.inboxTask, { projectId: fx.q });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'project_not_found' });
    expect(await taskRow(fx.inboxTask)).toEqual(before);
  });

  it("TC-40 to another workspace's project -> 404 project_not_found; task unchanged", async () => {
    const fx = await setup();
    const other = await member();
    const theirs = await createProject(other.browser, other.id, 'Theirs');
    const before = await taskRow(fx.inboxTask);
    const res = await patchTask(fx.browser, fx.id, fx.inboxTask, { projectId: theirs });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'project_not_found' });
    expect(await taskRow(fx.inboxTask)).toEqual(before);
  });

  it('TC-41 to a nonexistent project -> 404 project_not_found; task unchanged', async () => {
    const fx = await setup();
    const before = await taskRow(fx.inboxTask);
    const res = await patchTask(fx.browser, fx.id, fx.inboxTask, { projectId: newProjectId() });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'project_not_found' });
    expect(await taskRow(fx.inboxTask)).toEqual(before);
  });

  it('a malformed projectId -> 400 validation', async () => {
    const fx = await setup();
    expect((await patchTask(fx.browser, fx.id, fx.inboxTask, { projectId: 'xyz' })).status).toBe(400);
  });

  it('TC-42 a soft-deleted task -> 410 gone', async () => {
    const fx = await setup();
    expect((await deleteTask(fx.browser, fx.id, fx.inboxTask)).status).toBe(204);
    const res = await patchTask(fx.browser, fx.id, fx.inboxTask, { projectId: fx.p });
    expect(res.status).toBe(410);
    expect((await taskRow(fx.inboxTask))?.project_id).toBeNull();
  });

  it('an unknown task -> 404 not_found', async () => {
    const fx = await setup();
    const res = await patchTask(fx.browser, fx.id, newTaskId(), { projectId: fx.p });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
  });

  it('TC-43 a completed task moves and keeps completed_at, name and description', async () => {
    const fx = await setup();
    await markCompletedAt(fx.pTasks[0]!, '2026-09-24T17:30:00.000Z');
    const before = (await taskRow(fx.pTasks[0]!))!;
    const res = await patchTask(fx.browser, fx.id, fx.pTasks[0]!, { projectId: null });
    expect(res.status).toBe(200);
    expect(await taskRow(fx.pTasks[0]!)).toMatchObject({
      project_id: null,
      completed_at: '2026-09-24T17:30:00.000Z',
      name: before.name,
      description: before.description,
    });
  });
});

describe('tasks.project_scope_api: create in a project and list per project', () => {
  it('TC-44 create (client id) with an active projectId: 201; in P at the end; counts P open +1', async () => {
    const fx = await setup();
    const countsBefore = await counts(fx.browser, fx.id);
    const max = await maxSortOrder(fx.id);
    const id = newTaskId();
    const res = await postTask(fx.browser, fx.id, { id, name: 'Email Sam re: invoice #4411', projectId: fx.p });
    expect(res.status).toBe(201);
    expect(TaskResponse.parse(await res.json()).task).toMatchObject({ id, projectId: fx.p });
    expect(await taskRow(id)).toMatchObject({ project_id: fx.p, sort_order: max + TASK_SORT_STEP });
    expect((await counts(fx.browser, fx.id)).projects[fx.p]!.open).toBe(countsBefore.projects[fx.p]!.open + 1);
    // A retry with the same id is still idempotent (200, one row).
    expect((await postTask(fx.browser, fx.id, { id, name: 'Email Sam re: invoice #4411', projectId: fx.p })).status).toBe(200);
  });

  it('TC-45 create with a deleted projectId -> 404 project_not_found; task count unchanged', async () => {
    const fx = await setup();
    expect((await deleteProject(fx.browser, fx.id, fx.q)).status).toBe(200);
    const before = (await taskRows(fx.id)).length;
    const res = await postTask(fx.browser, fx.id, { id: newTaskId(), name: 'Plane shelf', projectId: fx.q });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'project_not_found' });
    expect(await taskRows(fx.id)).toHaveLength(before);
  });

  it('a replay after its project (and so the task) was deleted -> 410 gone, answered from the stored row', async () => {
    const fx = await setup();
    const id = newTaskId();
    expect((await postTask(fx.browser, fx.id, { id, name: 'Plane shelf', projectId: fx.q })).status).toBe(201);
    expect((await deleteProject(fx.browser, fx.id, fx.q)).status).toBe(200);
    // The replay is classified from the stored task (story 5's rule), not rejected as project_not_found.
    expect((await postTask(fx.browser, fx.id, { id, name: 'Plane shelf', projectId: fx.q })).status).toBe(410);
  });

  it('TC-46 list=project&projectId=P returns only P open tasks; list=inbox only tasks with no project', async () => {
    const fx = await setup();
    await markCompletedAt(fx.pTasks[1]!, '2026-09-24T17:30:00.000Z');
    const project = TaskListResponse.parse(await (await listTasks(fx.browser, fx.id, `?list=project&projectId=${fx.p}`)).json());
    expect(project.tasks.map((t) => t.id)).toEqual([fx.pTasks[0]]);
    const inbox = TaskListResponse.parse(await (await listTasks(fx.browser, fx.id, '?list=inbox')).json());
    expect(inbox.tasks.map((t) => t.name)).toEqual(['Buy milk', 'Call Mum 📞']);
    expect(inbox.tasks.every((t) => t.projectId === null)).toBe(true);
    const withCompleted = TaskListResponse.parse(
      await (await listTasks(fx.browser, fx.id, `?list=project&projectId=${fx.p}&include_completed=true`)).json(),
    );
    expect(withCompleted.tasks.map((t) => t.id)).toEqual([fx.pTasks[0], fx.pTasks[1]]);
  });

  it("TC-47 list=project for a deleted P -> 410; for another workspace's P -> 404 project_not_found; without projectId -> 400", async () => {
    const fx = await setup();
    expect((await deleteProject(fx.browser, fx.id, fx.q)).status).toBe(200);
    expect((await listTasks(fx.browser, fx.id, `?list=project&projectId=${fx.q}`)).status).toBe(410);
    const other = await member();
    const theirs = await createProject(other.browser, other.id, 'Theirs');
    const foreign = await listTasks(fx.browser, fx.id, `?list=project&projectId=${theirs}`);
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toMatchObject({ error: 'project_not_found' });
    const missing = await listTasks(fx.browser, fx.id, '?list=project');
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: 'validation' });
  });
});
