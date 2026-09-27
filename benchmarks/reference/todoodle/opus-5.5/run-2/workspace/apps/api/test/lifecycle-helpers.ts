import { env, SELF } from 'cloudflare:test';
import { LiveEvent } from '@todoodle/shared/events';
import { type Task, TaskSchema } from '@todoodle/shared/schemas';
import { afterEach, expect } from 'vitest';
import type { TaskRow } from '../src/db/tasks';
import { MULTILINE_DESCRIPTION, NAME_AT_LIMIT, TASK_NAMES } from './fixtures/tasks';
import { CLIENT_HEADERS, ORIGIN } from './helpers';
import { connectLive, type LiveClient, sleep } from './live-helpers';
import { createdTask } from './task-helpers';
import { type Created, createWorkspace, post } from './workspace-helpers';

/** Long enough for a broadcast (waitUntil) to have arrived if one was sent. */
export const NO_FRAME_WAIT_MS = 400;

export const CLIENT_X = '6c1f7a52-3d4e-4f8a-9b0c-1d2e3f4a5b6c';
export const CLIENT_Y = '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f';

export type LifecycleAction = 'complete' | 'reopen' | 'restore';

const taskPath = (workspaceId: string, taskId: string) => `/api/w/${workspaceId}/tasks/${taskId}`;

/** POST .../tasks/:id/<action>, bodyless unless `body` is given. */
export function lifecycle(
  workspaceId: string,
  cookie: string | null,
  taskId: string,
  action: LifecycleAction,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
) {
  return post(`${taskPath(workspaceId, taskId)}/${action}`, { cookie, body: opts.body, headers: opts.headers });
}

/** DELETE .../tasks/:id (no body). `headers` replaces the client header when given. */
export function deleteTask(workspaceId: string, cookie: string | null, taskId: string, headers: Record<string, string> = CLIENT_HEADERS) {
  return SELF.fetch(`${ORIGIN}${taskPath(workspaceId, taskId)}`, {
    method: 'DELETE',
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
  });
}

/** PATCH .../tasks/:id with a JSON body (or a raw string with its own content type). */
export function patchTask(
  workspaceId: string,
  cookie: string | null,
  taskId: string,
  body: unknown,
  opts: { headers?: Record<string, string>; contentType?: string } = {},
) {
  return SELF.fetch(`${ORIGIN}${taskPath(workspaceId, taskId)}`, {
    method: 'PATCH',
    headers: {
      ...(opts.headers ?? CLIENT_HEADERS),
      'Content-Type': opts.contentType ?? 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export async function rawRow(taskId: string): Promise<TaskRow | null> {
  return env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first<TaskRow>();
}

export async function taskFrom(res: Response): Promise<Task> {
  return TaskSchema.parse(((await res.json()) as { task: unknown }).task);
}

export type PriorState = 'Open' | 'Completed' | 'DeletedOpen' | 'DeletedCompleted';

/** Puts a task into a prior state directly in D1 (distinct, realistic completion times). */
export async function setState(taskId: string, state: PriorState, completedAt = '2026-09-20T08:15:00.000Z') {
  const completed = state === 'Completed' || state === 'DeletedCompleted' ? completedAt : null;
  const deleted = state === 'DeletedOpen' || state === 'DeletedCompleted' ? 1 : 0;
  await env.DB.prepare('UPDATE tasks SET completed_at = ?, deleted = ?, deleted_at = ? WHERE id = ?')
    .bind(completed, deleted, deleted ? '2026-09-21T09:00:00.000Z' : null, taskId)
    .run();
}

const sockets: LiveClient[] = [];
/** Call once per test file: closes the sockets opened with `live()`. */
export function closeSocketsAfterEach() {
  afterEach(() => sockets.splice(0).forEach((s) => s.close()));
}
export async function live(workspaceId: string, cookie: string) {
  const client = await connectLive(workspaceId, cookie);
  sockets.push(client);
  return client;
}

/** The next live event on the socket, parsed. */
export async function nextEvent(socket: LiveClient, seen = 0): Promise<LiveEvent> {
  return LiveEvent.parse(JSON.parse(await socket.nextFrame(seen)));
}

/** Waits long enough for a stray broadcast, then checks the socket got nothing more than `count` frames. */
export async function expectFrames(socket: LiveClient, count: number) {
  await sleep(NO_FRAME_WAIT_MS);
  expect(socket.frames).toHaveLength(count);
}

export type RealisticWorkspace = {
  a: Created;
  b: Created;
  /** Workspace A's tasks in creation order (12). */
  tasks: Task[];
  open: Task[];
  completed: { task: Task; completedAt: string }[];
  deletedOpen: Task;
  deletedCompleted: Task;
  bTasks: Task[];
};

/**
 * A workspace like real use, through the quick-add insert path (real sort_order): 12 tasks, one
 * name at TASK_NAME_MAX, emoji and RTL names, multi-line descriptions; 3 completed at distinct
 * times, 2 soft-deleted (one open, one completed); plus workspace B with 3 tasks.
 */
export async function seedRealistic(): Promise<RealisticWorkspace> {
  const a = await createWorkspace();
  const b = await createWorkspace(a.cookie);
  const specs = [
    { name: TASK_NAMES.milk, description: MULTILINE_DESCRIPTION },
    { name: TASK_NAMES.invoice },
    { name: TASK_NAMES.mum },
    { name: TASK_NAMES.dentist, description: 'Morning if possible\nBring the referral letter' },
    { name: NAME_AT_LIMIT },
    { name: 'שלום — call Dana 🎉' },
    { name: 'Renew passport', description: 'Photo booth at the station\nForm: HM Passport Office' },
    { name: 'Water the plants 🌿' },
    { name: 'Pay council tax' },
    { name: 'Return library books' },
    { name: 'Fix the bike light' },
    { name: 'Plan Saturday lunch' },
  ];
  const tasks: Task[] = [];
  for (const spec of specs) tasks.push(await createdTask(a.workspace.id, a.cookie, spec));
  const completedAt = ['2026-09-24T18:02:00.000Z', '2026-09-26T07:45:00.000Z', '2026-09-25T12:30:00.000Z'];
  const completedTasks = [tasks[2]!, tasks[6]!, tasks[9]!];
  for (const [i, task] of completedTasks.entries()) await setState(task.id, 'Completed', completedAt[i]);
  await setState(tasks[4]!.id, 'DeletedOpen');
  await setState(tasks[10]!.id, 'DeletedCompleted', '2026-09-23T10:00:00.000Z');
  const bTasks: Task[] = [];
  for (const name of ['B one', 'B two', 'B three']) bTasks.push(await createdTask(b.workspace.id, b.cookie, { name }));
  const gone = new Set([tasks[4]!.id, tasks[10]!.id, ...completedTasks.map((t) => t.id)]);
  return {
    a,
    b,
    tasks,
    open: tasks.filter((t) => !gone.has(t.id)),
    completed: completedTasks.map((task, i) => ({ task, completedAt: completedAt[i]! })),
    deletedOpen: tasks[4]!,
    deletedCompleted: tasks[10]!,
    bTasks,
  };
}
