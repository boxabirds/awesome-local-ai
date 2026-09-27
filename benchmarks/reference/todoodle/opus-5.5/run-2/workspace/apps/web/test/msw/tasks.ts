import { type Counts, CountsSchema, type Task, TaskSchema } from '@todoodle/shared/schemas';
import { http, HttpResponse } from 'msw';

export const TASK_WS_ID = '0123456789abcdef0123456789abcdef';

let seq = 0;
/** A task id like the client makes (32 lowercase hex), unique per call. */
export function taskId(n = ++seq): string {
  return n.toString(16).padStart(32, '0');
}

/** A task fixture, parsed through the shared schema so mocked shapes can't drift from the contract. */
export function task(overrides: Partial<Task> = {}): Task {
  return TaskSchema.parse({
    id: taskId(),
    workspaceId: TASK_WS_ID,
    name: 'Buy milk',
    description: '',
    sortOrder: 1,
    completedAt: null,
    version: 1,
    createdAt: '2026-09-27 10:00:00',
    updatedAt: '2026-09-27 10:00:00',
    ...overrides,
  });
}

/** Tasks named in order, with sortOrder 1..n. */
export function tasksNamed(...names: string[]): Task[] {
  return names.map((name, i) => task({ name, sortOrder: i + 1 }));
}

export const counts = (inbox: number): Counts => CountsSchema.parse({ inbox });

/** The task the server would return for a POSTed body (sortOrder given by the caller). */
export function taskFromBody(body: unknown, sortOrder: number): Task {
  const { id, name, description } = body as { id: string; name: string; description?: string };
  return task({ id, name: name.trim(), description: (description ?? '').trim(), sortOrder });
}

export const taskHandlers = {
  list: (tasks: Task[] = []) => http.get('/api/w/:id/tasks', () => HttpResponse.json({ tasks: tasks.map((t) => TaskSchema.parse(t)) })),
  counts: (inbox = 0) => http.get('/api/w/:id/counts', () => HttpResponse.json(counts(inbox))),
  /** Creates: answers 201 with the posted task; records every body. */
  create: (bodies: unknown[] = [], firstSortOrder = 1) =>
    http.post('/api/w/:id/tasks', async ({ request }) => {
      const body = await request.json();
      bodies.push(body);
      return HttpResponse.json({ task: taskFromBody(body, firstSortOrder + bodies.length - 1) }, { status: 201 });
    }),
};

/** Every workspace starts with an empty Inbox unless a test says otherwise. */
export const defaultTaskHandlers = [taskHandlers.list(), taskHandlers.counts()];
