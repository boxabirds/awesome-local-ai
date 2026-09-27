import { type Task, TaskSchema } from '@todoodle/shared/schemas';
import { act, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useEffect } from 'react';
import { vi } from 'vitest';
import { registerTaskHandlers } from '@/features/tasks/liveHandlers';
import { InboxView } from '@/features/tasks/InboxView';
import { useUndoShortcut } from '@/features/undo/useUndoShortcut';
import { server } from '../../msw';
import { TASK_WS_ID, task } from '../../msw/tasks';
import { renderWithProviders } from '../helpers';

export type Op = 'complete' | 'reopen' | 'restore' | 'delete' | 'patch';
export type Sent = { op: Op; id: string; body?: unknown };

type Answer = (id: string, body: unknown) => Response | undefined | Promise<Response | undefined>;

/**
 * A fake task server: a list (open, or with completed tasks when include_completed=true) and the
 * story 6 endpoints, applying each change to its own copy. Every request is recorded in `sent`.
 * `override[op]` can answer instead (return undefined to fall through).
 */
export function taskServer(initial: Task[], override: Partial<Record<Op | 'list', Answer>> = {}) {
  const tasks = new Map(initial.map((t) => [t.id, { ...t }]));
  const deleted = new Set<string>();
  const sent: Sent[] = [];
  const lists: string[] = [];
  const now = () => new Date().toISOString();

  const answer = (op: Op, id: string, change: (t: Task) => Task | null) => {
    const current = tasks.get(id);
    if (!current) return HttpResponse.json({ error: 'not_found', message: 'Not found.' }, { status: 404 });
    const next = change(current);
    if (next) tasks.set(id, next);
    if (op === 'delete') return new HttpResponse(null, { status: 204 });
    return HttpResponse.json({ task: TaskSchema.parse(tasks.get(id)) });
  };

  const route = (op: Op, change: (t: Task, body: unknown) => Task | null) => async ({ params, request }: { params: Record<string, unknown>; request: Request }) => {
    const id = String(params.taskId);
    const text = await request.text();
    const body = text ? JSON.parse(text) : undefined;
    sent.push(body === undefined ? { op, id } : { op, id, body });
    const custom = await override[op]?.(id, body);
    if (custom) return custom;
    return answer(op, id, (t) => change(t, body));
  };

  const bump = (t: Task, patch: Partial<Task>): Task => ({ ...t, ...patch, version: t.version + 1 });

  server.use(
    http.get('/api/w/:id/tasks', async ({ request }) => {
      const url = new URL(request.url);
      const include = url.searchParams.get('include_completed') === 'true';
      lists.push(include ? 'with-completed' : 'open');
      const custom = await override.list?.(include ? 'with-completed' : 'open', undefined);
      if (custom) return custom;
      const live = [...tasks.values()].filter((t) => !deleted.has(t.id));
      const open = live.filter((t) => t.completedAt === null).sort((a, b) => a.sortOrder - b.sortOrder);
      const done = live.filter((t) => t.completedAt !== null).sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : -1));
      return HttpResponse.json({ tasks: (include ? [...open, ...done] : open).map((t) => TaskSchema.parse(t)) });
    }),
    http.get('/api/w/:id/counts', () =>
      HttpResponse.json({ inbox: [...tasks.values()].filter((t) => !deleted.has(t.id) && t.completedAt === null).length }),
    ),
    http.post('/api/w/:id/tasks/:taskId/complete', route('complete', (t) => (t.completedAt ? null : bump(t, { completedAt: now() })))),
    http.post('/api/w/:id/tasks/:taskId/reopen', route('reopen', (t) => (t.completedAt ? bump(t, { completedAt: null }) : null))),
    http.post(
      '/api/w/:id/tasks/:taskId/restore',
      route('restore', (t) => {
        deleted.delete(t.id);
        return bump(t, {});
      }),
    ),
    http.delete(
      '/api/w/:id/tasks/:taskId',
      route('delete', (t) => {
        deleted.add(t.id);
        return bump(t, {});
      }),
    ),
    http.patch(
      '/api/w/:id/tasks/:taskId',
      route('patch', (t, body) => bump(t, body as Partial<Task>)),
    ),
  );
  return { sent, lists, tasks };
}

export const failWith =
  (status: number, error = status === 410 ? 'gone' : 'internal'): Answer =>
  () =>
    HttpResponse.json({ error, message: 'x' }, { status });

/** The Inbox with the shell-level pieces story 6 needs (Cmd/Ctrl+Z, live handlers). */
function Harness({ canEdit = true }: { canEdit?: boolean }) {
  useUndoShortcut();
  useEffect(() => registerTaskHandlers(), []);
  return <InboxView workspaceId={TASK_WS_ID} canEdit={canEdit} />;
}

/** Renders the Inbox and waits for its rows. */
export async function renderInbox(tasks: Task[], override: Partial<Record<Op | 'list', Answer>> = {}) {
  const srv = taskServer(tasks, override);
  const result = await renderWithProviders(<Harness />);
  if (tasks.some((t) => t.completedAt === null)) await screen.findByRole('list', { name: 'Tasks' });
  return { ...srv, ...result };
}

/** Four realistic open tasks (sortOrder 1..4). */
export function fourTasks(): Task[] {
  return [
    task({ name: 'Buy milk', description: 'Semi-skimmed, 2 pints', sortOrder: 1 }),
    task({ name: 'Email Sam re: invoice #4411', sortOrder: 2 }),
    task({ name: 'Call Mum 📞', sortOrder: 3 }),
    task({ name: 'Book dentist — ask about Tuesday', sortOrder: 4 }),
  ];
}

export const list = () => screen.getByRole('list', { name: 'Tasks' });
export const rows = () => within(list()).getAllByRole('listitem');
export const rowNames = () => (screen.queryByRole('list', { name: 'Tasks' }) ? rows().map((r) => r.querySelector('span.break-words')?.textContent) : []);
export const rowFor = (name: string) => screen.getByRole('listitem', { name });
export const checkbox = (name: string) => screen.getByRole('checkbox', { name: new RegExp(`^(Complete|Reopen) ${escape(name)}$`) });

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Lets pending promises, MSW answers and batched renders run (real timers). */
export async function settle(ms = 30) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** Fake setTimeout/Date only (frames and MSW keep running), from now on. */
export function fakeTime() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
}

/** Advances fake time inside act, letting promises run in between. */
export async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Focuses a task row (as the roving list would). */
export function focusRow(name: string) {
  act(() => rowFor(name).focus());
}

export function stubReducedMotion(reduce: boolean) {
  const original = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    if (query === '(prefers-reduced-motion: reduce)') {
      return {
        matches: reduce,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      } as MediaQueryList;
    }
    return original.call(window, query);
  });
}

/** A toast is gone, or leaving (sonner marks it data-removed and unmounts it after its exit animation). */
export function toastGone(text: string): boolean {
  const el = screen.queryByText(text);
  return !el || el.closest('[data-sonner-toast]')?.getAttribute('data-removed') === 'true';
}
