import type { Workspace } from '@todoodle/shared/schemas';
import { useMutation } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Server, WebSocket as MockWebSocket } from 'mock-socket';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/App';
import { useCanEdit } from '@/features/live/canEdit';
import { clientId } from '@/features/live/clientId';
import { liveUrl } from '@/features/live/LiveConnection';
import { LiveProvider } from '@/features/live/LiveProvider';
import { ACCESS_STATEMENT } from '@/features/share/copy';
import { markLinkSaved } from '@/features/share/linkSaved';
import { renameWorkspace } from '@/lib/api';
import { handleMutationError, OfflineError } from '@/lib/errors';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { handlers, linkFor, SECRET, WS_ID, workspace } from '../fixtures';
import { FakeSocket, OTHER_CLIENT, renameEvent, TASK_ID } from '../live-helpers';
import { server } from '../msw';
import { countRequests, primeCreated, renderApp } from '../render';
import { IdleWebSocket } from '../setup';

const OFFLINE_TEXT = "You're offline — changes can't be saved right now";
const CONFLICT_TEXT = 'Someone else changed this just now.';

function setGlobalWebSocket(value: unknown) {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value });
}

let mockServer: Server | undefined;

/** mock-socket server on this workspace's live URL; returns a function that sends to every client. */
function startLiveServer() {
  setGlobalWebSocket(MockWebSocket);
  mockServer = new Server(liveUrl(WS_ID));
  const clients: { send(data: string): void }[] = [];
  mockServer.on('connection', (socket) => {
    clients.push(socket);
  });
  return {
    clients,
    async emit(event: unknown) {
      await waitFor(() => expect(clients.length).toBeGreaterThan(0));
      await act(async () => {
        for (const c of clients) c.send(JSON.stringify(event));
      });
    },
  };
}

afterEach(() => {
  mockServer?.stop();
  mockServer = undefined;
});

beforeEach(() => {
  markLinkSaved(WS_ID); // no unsaved-link banner in these screens
});

const nameField = () => screen.findByLabelText<HTMLInputElement>('Workspace name');

/** The server's copy of the workspace: GET reads it, PATCH (via recordPatches) updates it. */
let serverCopy: Workspace;

async function openWorkspace(ws: Workspace = workspace()) {
  serverCopy = ws;
  primeCreated(ws, SECRET);
  server.use(http.get('/api/w/:id', () => HttpResponse.json({ workspace: serverCopy })));
  await renderApp({ pathname: '/w', hash: `#${SECRET}` });
  return nameField();
}

/** Offline that sticks: the window says so and the health probe keeps failing. */
async function goOffline() {
  server.use(http.get('/api/health', () => HttpResponse.error()));
  await act(async () => {
    window.dispatchEvent(new Event('offline'));
  });
}

async function goOnline() {
  server.use(http.get('/api/health', () => HttpResponse.json({ status: 'ok' })));
  await act(async () => {
    window.dispatchEvent(new Event('online'));
  });
}

/** Records PATCH bodies; a successful rename (the default answer) updates the server copy. */
function recordPatches(respond?: (body: { name: string }) => Response) {
  const bodies: unknown[] = [];
  server.use(
    http.patch('/api/w/:id', async ({ request }) => {
      const body = (await request.json()) as { name: string };
      bodies.push(body);
      if (respond) return respond(body);
      serverCopy = { ...serverCopy, name: body.name, version: serverCopy.version + 1 };
      return HttpResponse.json({ workspace: serverCopy });
    }),
  );
  return bodies;
}

async function typeDraft(input: HTMLInputElement, value: string) {
  act(() => input.focus());
  fireEvent.change(input, { target: { value } });
  expect(input.value).toBe(value);
}

describe('share.panel on story 2’s SharePanel', () => {
  it('TC-S06 secret in memory: link origin/w#secret, the exact access statement, zero requests', async () => {
    const links = countRequests('GET', /\/link$/);
    await openWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share' });
    expect(within(dialog).getByLabelText<HTMLInputElement>('Workspace link').value).toBe(linkFor(SECRET));
    const statement = [...dialog.querySelectorAll('#share-panel-description p')].map((p) => p.textContent).join(' ');
    expect(statement).toBe(ACCESS_STATEMENT);
    expect(statement).toContain("Access can't be removed yet");
    expect(links.count).toBe(0);
  });

  it('TC-S07 no secret (/w/:id): loading, then the fetched link', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    server.use(
      handlers.get(),
      http.get('/api/w/:id/link', async () => {
        await gate;
        return HttpResponse.json({ link: linkFor(SECRET) });
      }),
    );
    await renderApp({ pathname: `/w/${WS_ID}` });
    await nameField();
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Workspace name')).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share' });
    expect(within(dialog).getByLabelText('Loading the link')).toHaveAttribute('aria-busy', 'true');
    await act(async () => release());
    expect((await within(dialog).findByLabelText<HTMLInputElement>('Workspace link')).value).toBe(linkFor(SECRET));
  });

  it('TC-S08 offline (canEdit false): Share and Copy stay enabled', async () => {
    await openWorkspace();
    await goOffline();
    expect(await screen.findByText(OFFLINE_TEXT)).toBeInTheDocument();
    const share = screen.getByRole('button', { name: 'Share' });
    expect(share).toBeEnabled();
    fireEvent.click(share);
    const dialog = await screen.findByRole('dialog', { name: 'Share' });
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeEnabled();
  });
});

describe('live.client_sync', () => {
  it('TC-C09 children re-render 5 times: exactly one socket constructed', async () => {
    let bump!: () => void;
    function Child() {
      const [n, setN] = useState(0);
      bump = () => setN((x) => x + 1);
      return <span data-testid="renders">{n}</span>;
    }
    const { rerender } = render(
      <AppProviders>
        <LiveProvider workspaceId={WS_ID}>
          <Child />
        </LiveProvider>
      </AppProviders>,
    );
    for (let i = 0; i < 5; i++) act(() => bump());
    rerender(
      <AppProviders>
        <LiveProvider workspaceId={WS_ID}>
          <Child />
        </LiveProvider>
      </AppProviders>,
    );
    expect(screen.getByTestId('renders').textContent).toBe('5');
    expect(IdleWebSocket.instances).toHaveLength(1);
    expect(IdleWebSocket.instances[0]!.url).toBe(liveUrl(WS_ID));
  });

  it('TC-C10 the socket delivers workspace.updated: the header shows the new name', async () => {
    const live = startLiveServer();
    const input = await openWorkspace();
    await live.emit(renameEvent('Groceries from Sam', 2));
    await waitFor(() => expect(input.value).toBe('Groceries from Sam'));
  });

  it('TC-C17 the announcer region is visually hidden, role=status, aria-live=polite, with the message', async () => {
    const live = startLiveServer();
    await openWorkspace();
    await live.emit(renameEvent('Trip', 2));
    const region = screen.getByTestId('live-announcer');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveClass('sr-only');
    await waitFor(() => expect(region).toHaveTextContent('1 change made by someone else'));
  });
});

describe('live.connection_status', () => {
  it('TC-O09 open and online: no pill, no banner, editing enabled', async () => {
    startLiveServer();
    const input = await openWorkspace();
    await waitFor(() => expect(input).toBeEnabled());
    expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
    expect(screen.queryByText(OFFLINE_TEXT)).not.toBeInTheDocument();
  });

  it('TC-O10 socket paused 5,000 ms, online: Reconnecting… pill, rename still editable and saved', async () => {
    const patches = recordPatches();
    // Fake timers from before the socket starts. The cache is primed, so the screen renders at
    // once (no polling queries, which would need real timers).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    serverCopy = workspace();
    primeCreated(serverCopy, SECRET);
    server.use(http.get('/api/w/:id', () => HttpResponse.json({ workspace: serverCopy })));
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    const input = screen.getByLabelText<HTMLInputElement>('Workspace name');
    act(() => vi.advanceTimersByTime(4_999));
    expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('Reconnecting…')).toHaveAttribute('role', 'status');
    vi.useRealTimers();
    expect(input).toBeEnabled();
    await typeDraft(input, 'Groceries 2');
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await waitFor(() => expect(patches).toEqual([{ name: 'Groceries 2' }]));
    expect(screen.queryByText(OFFLINE_TEXT)).not.toBeInTheDocument();
  });

  it('TC-O11 offline: banner text with role=status, editing disabled, Share enabled', async () => {
    const input = await openWorkspace();
    await goOffline();
    const banner = await screen.findByText(OFFLINE_TEXT);
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(input).toBeDisabled();
    expect(input.closest('fieldset')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled();
    expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
  });

  it('TC-O12 a typed draft survives going offline and back online in the same input node', async () => {
    const input = await openWorkspace();
    await typeDraft(input, 'Groceries 2');
    await goOffline();
    await screen.findByText(OFFLINE_TEXT);
    expect(screen.getByLabelText('Workspace name')).toBe(input);
    expect(input.value).toBe('Groceries 2');
    expect(input).toBeDisabled();
    await goOnline();
    await waitFor(() => expect(screen.queryByText(OFFLINE_TEXT)).not.toBeInTheDocument());
    expect(screen.getByLabelText('Workspace name')).toBe(input);
    expect(input).toBeEnabled();
    expect(input.value).toBe('Groceries 2');
  });

  it('TC-O18 offline: api mutate rejects with OfflineError; MSW sees zero requests', async () => {
    await openWorkspace();
    const patches = countRequests('PATCH', /^\/api\/w\//);
    await goOffline();
    await expect(renameWorkspace(WS_ID, 'Groceries 2')).rejects.toBeInstanceOf(OfflineError);
    expect(patches.count).toBe(0);
  });

  it('TC-O19 socket status flips 5 times: a useCanEdit consumer does not re-render', async () => {
    FakeSocket.all = [];
    setGlobalWebSocket(FakeSocket);
    let renders = 0;
    function Consumer() {
      renders++;
      return <span>{useCanEdit() ? 'editable' : 'locked'}</span>;
    }
    render(
      <AppProviders>
        <LiveProvider workspaceId={WS_ID}>
          <Consumer />
        </LiveProvider>
      </AppProviders>,
    );
    const initial = renders;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => FakeSocket.last.serverOpen()); // 1 connecting -> open
    act(() => FakeSocket.last.serverClose(1006)); // 2 open -> reconnecting
    act(() => vi.advanceTimersByTime(1_200)); // 3 reconnecting -> connecting
    act(() => FakeSocket.last.serverOpen()); // 4 connecting -> open
    act(() => FakeSocket.last.serverClose(1006)); // 5 open -> reconnecting
    expect(renders).toBe(initial);
    expect(screen.getByText('editable')).toBeInTheDocument();
  });
});

describe('live.conflict_notice', () => {
  async function conflictOnName() {
    const live = startLiveServer();
    const input = await openWorkspace();
    await waitFor(() => expect(live.clients.length).toBe(1));
    await typeDraft(input, 'Groceries (mine)');
    await live.emit(renameEvent('Groceries (theirs)', 2));
    const notice = await screen.findByRole('alert');
    return { live, input, notice };
  }

  it('TC-G22 editing draft X, other rename Y: input shows Y; inline alert with Y and both choices', async () => {
    const { input, notice } = await conflictOnName();
    expect(input.value).toBe('Groceries (theirs)');
    expect(notice).toHaveTextContent(CONFLICT_TEXT);
    expect(notice).toHaveTextContent('Groceries (theirs)');
    expect(within(notice).getByRole('button', { name: 'Use my version' })).toBeInTheDocument();
    expect(within(notice).getByRole('button', { name: 'Keep theirs' })).toBeInTheDocument();
  });

  it('TC-G23 Use my version: PATCH {name: X}; notice removed; input X', async () => {
    const patches = recordPatches();
    const { input, notice } = await conflictOnName();
    await act(async () => fireEvent.click(within(notice).getByRole('button', { name: 'Use my version' })));
    await waitFor(() => expect(patches).toEqual([{ name: 'Groceries (mine)' }]));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(input.value).toBe('Groceries (mine)');
  });

  it('TC-G24 both buttons are in the tab order after the field; Enter on Keep theirs clears it with no PATCH', async () => {
    const patches = recordPatches();
    const { input, notice } = await conflictOnName();
    const mine = within(notice).getByRole('button', { name: 'Use my version' });
    const theirs = within(notice).getByRole('button', { name: 'Keep theirs' });
    const tabbable = [...document.querySelectorAll<HTMLElement>('input, button')].filter(
      (el) => !(el as HTMLButtonElement).disabled && el.tabIndex >= 0,
    );
    const at = tabbable.indexOf(input);
    expect(tabbable.slice(at + 1, at + 3)).toEqual([mine, theirs]);
    // Tab from the field to the button: moving focus into the notice keeps the editor open.
    act(() => {
      fireEvent.blur(input, { relatedTarget: theirs });
      theirs.focus();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Enter on a focused button activates it (a click).
    await act(async () => {
      fireEvent.keyDown(theirs, { key: 'Enter' });
      fireEvent.click(theirs);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input.value).toBe('Groceries (theirs)');
    expect(patches).toEqual([]);
  });

  it('TC-G25 editor closed after our save: two conflicts -> one persistent toast (replaced), both actions, still there after 60 s', async () => {
    recordPatches();
    const live = startLiveServer();
    const input = await openWorkspace();
    await waitFor(() => expect(live.clients.length).toBe(1));
    await typeDraft(input, 'Packing list');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await waitFor(() => expect(input.value).toBe('Packing list'));
    await waitFor(() => expect(queryClient.getQueryData<Workspace>(queryKeys.workspace(WS_ID))?.version).toBe(2));
    await live.emit(renameEvent('Trip list', 3));
    await screen.findByText('Their version: Trip list');
    await live.emit(renameEvent('Holiday list', 4));
    await screen.findByText('Their version: Holiday list');
    expect(screen.queryByRole('alert', { name: CONFLICT_TEXT })).not.toBeInTheDocument();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    act(() => vi.advanceTimersByTime(60_000));
    vi.useRealTimers();
    const toasts = document.querySelectorAll('[data-sonner-toast]');
    expect(toasts).toHaveLength(1);
    const toast = toasts[0] as HTMLElement;
    expect(toast).toHaveTextContent(CONFLICT_TEXT);
    expect(toast).toHaveTextContent('Their version: Holiday list');
    expect(within(toast).getByRole('button', { name: 'Use my version' })).toBeInTheDocument();
    expect(within(toast).getByRole('button', { name: 'Keep theirs' })).toBeInTheDocument();
  });

  it('TC-G26 synthetic task editor, server answers 410: rollback, entity removed from caches, "This task was deleted"', async () => {
    const tasksKey = [...queryKeys.root(WS_ID), 'tasks'];
    const taskKey = [...queryKeys.root(WS_ID), 'task', TASK_ID];
    const task = { id: TASK_ID, title: 'Buy milk', version: 1 };
    const other = { id: 'b1b2c3d4e5f60718293a4b5c6d7e8f90', title: 'Call Sam', version: 1 };
    queryClient.setQueryData(tasksKey, [task, other]);
    queryClient.setQueryData(taskKey, task);
    // The transport is a real api.ts mutation; the server says the entity is gone.
    server.use(http.patch('/api/w/:id', () => HttpResponse.json({ error: 'gone', message: 'x' }, { status: 410 })));
    const rolledBack = vi.fn();

    function TaskEditor() {
      const save = useMutation({
        mutationFn: (title: string) => renameWorkspace(WS_ID, title),
        onMutate: (title) => {
          const previous = queryClient.getQueryData(tasksKey);
          queryClient.setQueryData(tasksKey, [{ ...task, title }, other]);
          return { previous };
        },
        onError: (error, _title, context) =>
          handleMutationError(error, {
            key: `task:${TASK_ID}`,
            entityLabel: 'task',
            rollback: () => {
              rolledBack();
              queryClient.setQueryData(tasksKey, context?.previous);
            },
          }),
      });
      return (
        <button type="button" onClick={() => save.mutate('Buy oat milk')}>
          Save task
        </button>
      );
    }
    render(
      <AppProviders>
        <TaskEditor />
      </AppProviders>,
    );
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save task' })));
    expect(await screen.findByText('This task was deleted')).toBeInTheDocument();
    expect(rolledBack).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(tasksKey)).toEqual([other]);
    expect(queryClient.getQueryData(taskKey)).toBeUndefined();
  });

  it('TC-G27 editing, our own echo arrives: no notice', async () => {
    const live = startLiveServer();
    const input = await openWorkspace();
    await waitFor(() => expect(live.clients.length).toBe(1));
    await typeDraft(input, 'Groceries (mine)');
    await live.emit(renameEvent('Groceries (echo)', 2, clientId));
    await live.emit(renameEvent('Groceries (echo 2)', 3, clientId));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input.value).toBe('Groceries (mine)');
  });

  it('another person’s rename while not editing is applied without a notice', async () => {
    const live = startLiveServer();
    const input = await openWorkspace();
    await live.emit(renameEvent('Renamed by Sam', 2, OTHER_CLIENT));
    await waitFor(() => expect(input.value).toBe('Renamed by Sam'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
