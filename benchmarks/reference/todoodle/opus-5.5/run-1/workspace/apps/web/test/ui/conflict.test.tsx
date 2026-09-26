import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { clientId } from '@/features/live/clientId';
import { request } from '@/lib/api';
import { handleMutationError } from '@/lib/errors';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { server } from '../msw.ts';
import { recordRequests } from '../support/fixtures.ts';
import { TASK_ID } from '../support/liveFixtures.ts';
import { startLiveServer, workspaceBackend } from '../support/live.ts';
import { Providers } from '../support/render.tsx';
import { ID, enterByHash } from '../support/workspace.ts';

const CONFLICT_TEXT = 'Someone else changed this just now.';

function nameInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Workspace name' });
}

/** Editing the name with draft X ('Groceries 2') when someone else renames it to Y ('Chores'). */
async function conflictWhileEditing() {
  const backend = workspaceBackend();
  const live = startLiveServer();
  const rendered = await enterByHash({ saved: true });
  await waitFor(() => expect(live.clients()).toHaveLength(1));
  const input = nameInput();
  await rendered.user.click(input);
  await rendered.user.clear(input);
  await rendered.user.type(input, 'Groceries 2');
  live.emit(backend.remoteRename('Chores'));
  const notice = await screen.findByRole('alert');
  return { ...rendered, live, bodies: backend.patches, backend, input, notice };
}

describe('live.conflict_notice: the user chooses whose version to keep', () => {
  it('TC-G22 editing draft X, other rename Y: input shows Y; alert notice shows Y with Use my version and Keep theirs', async () => {
    const { input, notice, bodies } = await conflictWhileEditing();
    expect(input).toHaveValue('Chores');
    expect(within(notice).getByText(CONFLICT_TEXT)).toBeInTheDocument();
    expect(within(notice).getByText('Chores')).toBeInTheDocument();
    expect(within(notice).getByRole('button', { name: 'Use my version' })).toBeInTheDocument();
    expect(within(notice).getByRole('button', { name: 'Keep theirs' })).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('the notice persists: leaving the field does not dismiss it or save anything', async () => {
    const { input, bodies } = await conflictWhileEditing();
    fireEvent.blur(input);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('TC-G23 Use my version: PATCH body {name: X}; notice removed; input X', async () => {
    const { user, notice, bodies } = await conflictWhileEditing();
    await user.click(within(notice).getByRole('button', { name: 'Use my version' }));
    await waitFor(() => expect(bodies).toEqual([{ name: 'Groceries 2' }]));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(() => expect(nameInput()).toHaveValue('Groceries 2'));
  });

  it('TC-G24 keyboard: Tab reaches both buttons; Enter on Keep theirs removes the notice; no PATCH', async () => {
    const { user, bodies } = await conflictWhileEditing();
    const seen = recordRequests();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Use my version' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Keep theirs' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(nameInput()).toHaveValue('Chores');
    expect(bodies).toEqual([]);
    expect(seen.filter((r) => r.startsWith('PATCH'))).toEqual([]);
  });

  it('Escape (closing the editor) keeps theirs', async () => {
    const { user, bodies } = await conflictWhileEditing();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(nameInput()).toHaveValue('Chores');
    expect(bodies).toEqual([]);
  });

  it('TC-G25 editor closed (recently saved): two conflicts on the key -> one persistent toast with both actions after 60 s', async () => {
    const backend = workspaceBackend();
    const bodies = backend.patches;
    const live = startLiveServer();
    const { user } = await enterByHash({ saved: true });
    await waitFor(() => expect(live.clients()).toHaveLength(1));
    await user.click(nameInput());
    await user.clear(nameInput());
    await user.type(nameInput(), 'Groceries 2{Enter}');
    await waitFor(() => expect(bodies).toEqual([{ name: 'Groceries 2' }]));
    await waitFor(() => expect(nameInput()).toHaveValue('Groceries 2'));

    live.emit(backend.remoteRename('Chores'));
    await screen.findByText(CONFLICT_TEXT);
    live.emit(backend.remoteRename('Trip'));
    await screen.findByText('Now: Trip');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => vi.advanceTimersByTime(60_000));
    vi.useRealTimers();
    expect(screen.getAllByText(CONFLICT_TEXT)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Use my version' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep theirs' })).toBeInTheDocument();
    expect(screen.queryByRole('alert', { name: CONFLICT_TEXT })).toBeNull(); // no inline notice: editor closed

    // Use my version from the toast saves the user's name again.
    await user.click(screen.getByRole('button', { name: 'Use my version' }));
    await waitFor(() => expect(bodies).toEqual([{ name: 'Groceries 2' }, { name: 'Groceries 2' }]));
    await waitFor(() => expect(screen.queryByText(CONFLICT_TEXT)).toBeNull());
  });

  it('TC-G27 editing + an own-echo event: no notice', async () => {
    const backend = workspaceBackend();
    const live = startLiveServer();
    const { user } = await enterByHash({ saved: true });
    await waitFor(() => expect(live.clients()).toHaveLength(1));
    await user.click(nameInput());
    await user.type(nameInput(), ' 2');
    live.emit(backend.remoteRename('Echo', clientId));
    // Give the frame batch time to flush (it would have applied by now).
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status', { name: 'Changes by others' })).toHaveTextContent('');
    expect(nameInput()).toHaveValue('My Todoodle 2');
  });
});

type Task = { id: string; title: string; version: number };
const TASKS_KEY = queryKeys.tasks(ID);

/** A minimal task editor as stories 5 and 6 will build it: optimistic, with the standard error handling. */
function SyntheticTaskEditor() {
  const client = useQueryClient();
  const { data = [] } = useQuery({ queryKey: TASKS_KEY, queryFn: () => [] as Task[], staleTime: Infinity });
  const mutation = useMutation({
    mutationFn: (title: string) =>
      request(z.unknown(), `/api/w/${ID}/tasks/${TASK_ID}`, { method: 'PATCH', json: { title }, edit: true }),
    onMutate: (title) => {
      const previous = client.getQueryData<Task[]>(TASKS_KEY);
      client.setQueryData<Task[]>(TASKS_KEY, (list) => list?.map((task) => (task.id === TASK_ID ? { ...task, title } : task)));
      return { rollback: () => client.setQueryData(TASKS_KEY, previous) };
    },
    onError: (error, _title, context) =>
      handleMutationError(error, { key: `task:${TASK_ID}`, entityLabel: 'task', workspaceId: ID, queryClient: client, rollback: context?.rollback }),
  });
  return (
    <div>
      <ul>
        {data.map((task) => (
          <li key={task.id}>{task.title}</li>
        ))}
      </ul>
      <button type="button" onClick={() => mutation.mutate('Buy oat milk')}>
        Save
      </button>
    </div>
  );
}

describe('live.conflict_notice: 410 gone on save', () => {
  it('TC-G26 MSW answers 410: rollback, the task is removed from [ws, id, ...] caches, toast "This task was deleted"', async () => {
    server.use(http.patch('/api/w/:id/tasks/:taskId', () => HttpResponse.json({ error: 'gone', message: 'x' }, { status: 410 })));
    queryClient.setQueryData<Task[]>(TASKS_KEY, [
      { id: TASK_ID, title: 'Buy milk', version: 1 },
      { id: 'B1B2C3D4E5F60718293A4B5C6D7E8F90', title: 'Call mum', version: 1 },
    ]);
    render(
      <Providers entry="/">
        <SyntheticTaskEditor />
      </Providers>,
    );
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('This task was deleted');
    expect(queryClient.getQueryData<Task[]>(TASKS_KEY)).toEqual([{ id: 'B1B2C3D4E5F60718293A4B5C6D7E8F90', title: 'Call mum', version: 1 }]);
    await waitFor(() => expect(screen.queryByText('Buy oat milk')).toBeNull());
    expect(screen.queryByText('Buy milk')).toBeNull();
  });
});
