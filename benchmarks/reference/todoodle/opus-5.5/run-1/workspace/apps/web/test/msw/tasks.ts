import { http, HttpResponse, delay } from 'msw';
import { type Counts, CountsSchema, type Task, TaskListResponse, TaskResponse, TaskSchema } from '@todoodle/shared/schemas';

// MSW handlers for story 5's endpoints. Every response goes through the shared zod schemas, so the
// mocked shapes can't drift from the real contract.

const WORKSPACE_ID = '0123456789ABCDEF0123456789ABCDEF';

/** Realistic task names (mirrors apps/api/test/fixtures/tasks.ts). */
export const TASK_NAMES = ['Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞', 'Book dentist — ask about Tuesday', 'Water the plants'];

let counter = 0;
/** A 32-char lowercase hex id, unique within the test run. */
export function taskId(n = ++counter): string {
  return n.toString(16).padStart(32, 'a');
}

export function makeTask(fields: Partial<Task> & { name: string }, index = 0): Task {
  return TaskSchema.parse({
    id: taskId(),
    workspaceId: WORKSPACE_ID,
    description: '',
    sortOrder: index + 1,
    completedAt: null,
    version: 1,
    createdAt: '2026-09-26 10:00:00',
    updatedAt: '2026-09-26 10:00:00',
    ...fields,
  });
}

/** `count` realistic tasks in order (names cycle through TASK_NAMES, numbered past the first round). */
export function makeTasks(count: number): Task[] {
  return Array.from({ length: count }, (_, i) =>
    makeTask({ name: i < TASK_NAMES.length ? TASK_NAMES[i]! : `${TASK_NAMES[i % TASK_NAMES.length]} ${i + 1}` }, i),
  );
}

type ListOpts = { tasks?: Task[]; status?: number; until?: Promise<unknown>; onRequest?: (url: string) => void };

export function listHandler({ tasks = [], status = 200, until, onRequest }: ListOpts = {}) {
  return http.get('/api/w/:id/tasks', async ({ request }) => {
    onRequest?.(request.url);
    await until;
    if (status !== 200) return HttpResponse.json({ error: 'internal', message: 'x' }, { status });
    return HttpResponse.json(TaskListResponse.parse({ tasks }));
  });
}

export function countsHandler({ counts = { inbox: 0 }, status = 200, until }: { counts?: Counts; status?: number; until?: Promise<unknown> } = {}) {
  return http.get('/api/w/:id/counts', async () => {
    await until;
    if (status !== 200) return HttpResponse.json({ error: 'internal', message: 'x' }, { status });
    return HttpResponse.json(CountsSchema.parse(counts));
  });
}

export type CreateOutcome = 201 | 200 | 400 | 409 | 410 | 500 | 403 | 404 | 'network' | 'never';

/**
 * POST /api/w/:id/tasks. `outcomes` are used in order, one per request (the last one repeats). The
 * server task echoes the request body, as the real endpoint does.
 */
export function createHandler({
  outcomes = [201],
  bodies,
  until,
}: { outcomes?: CreateOutcome[]; bodies?: unknown[]; until?: Promise<unknown> } = {}) {
  let call = 0;
  return http.post('/api/w/:id/tasks', async ({ request, params }) => {
    const body = (await request.json()) as { id: string; name: string; description?: string };
    bodies?.push(body);
    const outcome = outcomes[Math.min(call++, outcomes.length - 1)]!;
    await until;
    if (outcome === 'never') {
      await delay('infinite');
      return HttpResponse.error();
    }
    if (outcome === 'network') return HttpResponse.error();
    if (outcome !== 201 && outcome !== 200) {
      const code = { 400: 'validation', 409: 'id_conflict', 410: 'gone', 500: 'internal', 403: 'forbidden_client', 404: 'not_found' }[outcome];
      return HttpResponse.json({ error: code, message: 'x' }, { status: outcome });
    }
    const task = makeTask({ id: body.id, workspaceId: String(params.id), name: body.name.trim(), description: (body.description ?? '').trim() });
    return HttpResponse.json(TaskResponse.parse({ task }), { status: outcome });
  });
}

/** Defaults every test starts with: an empty Inbox. */
export const defaultTaskHandlers = [listHandler(), countsHandler()];
