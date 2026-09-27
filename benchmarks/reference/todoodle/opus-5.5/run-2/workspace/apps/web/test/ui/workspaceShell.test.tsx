import { NAME_HINT_MS } from '@todoodle/shared/limits';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/App';
import { markLinkSaved } from '@/features/share/linkSaved';
import { WorkspaceById } from '@/routes/Workspace';
import { handlers, SECRET, WS_ID, workspace } from '../fixtures';
import { server } from '../msw';
import { currentLocation, deferred, primeCreated, renderApp, restoreClipboard, stubClipboard, titleText } from '../render';

const edit = vi.hoisted(() => ({ canEdit: true }));
vi.mock('@/features/live/canEdit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/live/canEdit')>()),
  useCanEdit: () => edit.canEdit,
}));

beforeEach(() => {
  edit.canEdit = true;
});
afterEach(() => restoreClipboard());

function recordPatches(respond: () => Response | Promise<Response> = () => HttpResponse.json({ workspace: workspace({ name: 'Groceries', version: 2 }) })) {
  const bodies: unknown[] = [];
  server.use(
    http.patch('/api/w/:id', async ({ request }) => {
      bodies.push(await request.json());
      return respond();
    }),
  );
  return bodies;
}

function recordOpens(respond: () => Response | Promise<Response> = () => HttpResponse.json({ workspace: workspace(), dropped: 0 })) {
  const bodies: unknown[] = [];
  server.use(
    http.post('/api/workspaces/open', async ({ request }) => {
      bodies.push(await request.json());
      return respond();
    }),
  );
  return bodies;
}

const nameField = () => screen.findByLabelText<HTMLInputElement>('Workspace name');

async function renameTo(value: string) {
  const input = await nameField();
  act(() => input.focus());
  fireEvent.change(input, { target: { value } });
  act(() => {
    fireEvent.keyDown(input, { key: 'Enter' });
  });
  expect(document.activeElement).not.toBe(input);
  return input;
}

describe('workspace route: /w#secret', () => {
  it('TC-47 opens with the secret, shows the name, keeps the hash', async () => {
    const opens = recordOpens();
    server.use(handlers.get());
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    expect((await nameField()).value).toBe('My Todoodle');
    expect(opens).toEqual([{ secret: SECRET }]);
    expect(currentLocation.value?.hash).toBe(`#${SECRET}`);
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    // Story 5 replaced the placeholder with the real empty Inbox.
    expect(await screen.findByText('Your Inbox is clear. Press Q to add a task.')).toBeInTheDocument();
  });

  it('TC-78 while open is pending: skeleton with aria-busy, no NotFound', async () => {
    const gate = deferred();
    recordOpens(async () => {
      await gate.promise;
      return HttpResponse.json({ workspace: workspace(), dropped: 0 });
    });
    server.use(handlers.get());
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    expect(await screen.findByTestId('workspace-skeleton')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('heading', { name: 'Workspace not found' })).not.toBeInTheDocument();
    await act(async () => gate.resolve());
    expect((await nameField()).value).toBe('My Todoodle');
    expect(screen.queryByTestId('workspace-skeleton')).not.toBeInTheDocument();
  });

  it('TC-78 with a primed cache the name renders immediately, no skeleton, no open', async () => {
    const opens = recordOpens();
    primeCreated(workspace(), SECRET);
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    expect(screen.getByLabelText<HTMLInputElement>('Workspace name').value).toBe('My Todoodle');
    expect(screen.queryByTestId('workspace-skeleton')).not.toBeInTheDocument();
    expect(opens).toEqual([]);
  });

  it.each([
    ['a 500', () => HttpResponse.json({ error: 'internal', message: 'x' }, { status: 500 })],
    ['a network error', () => HttpResponse.error()],
  ])("TC-79 %s -> 'Couldn't load this workspace.' + Try again; retry sends exactly one request", async (_label, fail) => {
    let attempt = 0;
    const opens = recordOpens(() => (++attempt === 1 ? fail() : HttpResponse.json({ workspace: workspace(), dropped: 0 })));
    server.use(handlers.get());
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load this workspace.");
    expect(screen.queryByRole('heading', { name: 'Workspace not found' })).not.toBeInTheDocument();
    expect(opens).toHaveLength(1);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
    expect((await nameField()).value).toBe('My Todoodle');
    expect(opens).toHaveLength(2);
  });

  it('TC-79 a 404 renders NotFound, not the retry state', async () => {
    server.use(handlers.openNotFound());
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    expect(await screen.findByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load this workspace.")).not.toBeInTheDocument();
  });

  it('TC-51 the <title> is "Todoodle - <name>" and never contains the secret, panel open or closed', async () => {
    primeCreated(workspace(), SECRET);
    await renderApp({ pathname: '/w', hash: `#${SECRET}`, state: { justCreated: true } });
    await screen.findByRole('dialog', { name: 'Save your link' });
    await waitFor(() => expect(titleText()).toBe('Todoodle - My Todoodle'));
    expect(document.title).not.toContain(SECRET);
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(titleText()).toBe('Todoodle - My Todoodle');
    expect(document.title).not.toContain(SECRET);
    expect(document.head.innerHTML).not.toContain(SECRET);
  });

  it('TC-81 no code writes document.title directly', async () => {
    const setter = vi.fn();
    const proto = Object.getPrototypeOf(document) as object;
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'title') ?? Object.getOwnPropertyDescriptor(proto, 'title');
    Object.defineProperty(document, 'title', {
      configurable: true,
      get: () => descriptor?.get?.call(document),
      set: setter,
    });
    try {
      primeCreated(workspace(), SECRET);
      server.use(handlers.get(workspace({ name: 'Groceries', version: 2 })));
      await renderApp({ pathname: '/w', hash: `#${SECRET}`, state: { justCreated: true } });
      await screen.findByRole('dialog');
      fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
      recordPatches();
      await renameTo('Groceries');
      await waitFor(() => expect(titleText()).toBe('Todoodle - Groceries'));
      expect(setter).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, 'title');
    }
  });
});

describe('header rename', () => {
  beforeEach(() => {
    primeCreated(workspace(), SECRET);
    markLinkSaved(WS_ID);
  });

  it('TC-48 Enter shows the trimmed name before PATCH resolves; PATCH gets the trimmed name', async () => {
    const gate = deferred();
    const patches = recordPatches(async () => {
      await gate.promise;
      return HttpResponse.json({ workspace: workspace({ name: 'Groceries', version: 2 }) });
    });
    server.use(handlers.get(workspace({ name: 'Groceries', version: 2 })));
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    const input = await renameTo('  Groceries  ');
    await waitFor(() => expect(patches).toEqual([{ name: 'Groceries' }]));
    expect(input.value).toBe('Groceries');
    await waitFor(() => expect(titleText()).toBe('Todoodle - Groceries'));
    await act(async () => gate.resolve());
    expect(input.value).toBe('Groceries');
  });

  it("TC-49 an empty name restores the previous one, sends nothing, and says 'Name can't be empty'", async () => {
    const patches = recordPatches();
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    const input = await renameTo('   ');
    expect(input.value).toBe('My Todoodle');
    const hint = screen.getByText("Name can't be empty");
    expect(hint).toHaveAttribute('role', 'status');
    await new Promise((r) => setTimeout(r, 20));
    expect(patches).toEqual([]);
  });

  it('TC-50 PATCH 500 restores the previous name and shows an error toast', async () => {
    const gate = deferred();
    recordPatches(async () => {
      await gate.promise;
      return HttpResponse.json({ error: 'internal', message: 'x' }, { status: 500 });
    });
    server.use(handlers.get());
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    const input = await renameTo('Groceries');
    expect(input.value).toBe('Groceries');
    await act(async () => gate.resolve());
    expect(await screen.findByText("Couldn't rename the workspace — try again.")).toBeInTheDocument();
    await waitFor(() => expect(input.value).toBe('My Todoodle'));
  });

  it('TC-80 an unchanged name sends nothing', async () => {
    const patches = recordPatches();
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    await renameTo(' My Todoodle ');
    await new Promise((r) => setTimeout(r, 20));
    expect(patches).toEqual([]);
    expect(screen.getByLabelText<HTMLInputElement>('Workspace name').value).toBe('My Todoodle');
  });

  it('TC-80 the empty-name hint is visible at 2,499 ms and gone at 2,501 ms', async () => {
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    const input = await nameField();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '' } });
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(screen.getByText("Name can't be empty")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(NAME_HINT_MS - 1));
    expect(screen.getByText("Name can't be empty")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2));
    expect(screen.queryByText("Name can't be empty")).not.toBeInTheDocument();
  });

  it('Escape cancels the edit without a request', async () => {
    const patches = recordPatches();
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    const input = await nameField();
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'Something else' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('My Todoodle');
    await new Promise((r) => setTimeout(r, 20));
    expect(patches).toEqual([]);
  });

  it('TC-94 canEdit true: the name editor is enabled', async () => {
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    expect(await nameField()).toBeEnabled();
  });
});

describe('edit gate', () => {
  it('TC-94 canEdit false disables the name editor; Share, panel copy and banner Copy still work', async () => {
    edit.canEdit = false;
    primeCreated(workspace(), SECRET);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    expect(await nameField()).toBeDisabled();

    // Banner Copy.
    const banner = screen.getByText(/Your link isn't saved yet/).closest('[role="status"]') as HTMLElement;
    const bannerCopy = [...banner.querySelectorAll('button')].find((b) => b.textContent === 'Copy link')!;
    expect(bannerCopy).toBeEnabled();
    await act(async () => fireEvent.click(bannerCopy));
    expect(writeText).toHaveBeenCalledWith(`http://localhost:3000/w#${SECRET}`);
    await waitFor(() => expect(screen.queryByText(/Your link isn't saved yet/)).not.toBeInTheDocument());

    // Share button and panel copy.
    const share = screen.getByRole('button', { name: 'Share' });
    expect(share).toBeEnabled();
    fireEvent.click(share);
    const dialog = await screen.findByRole('dialog', { name: 'Share' });
    const copy = [...dialog.querySelectorAll('button')].find((b) => b.textContent?.includes('Copy link'))!;
    expect(copy).toBeEnabled();
    await act(async () => fireEvent.click(copy));
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });
});

describe('workspace route: /w/:workspaceId', () => {
  it('TC-64 renders from GET /api/w/:id; the title has no secret', async () => {
    let gets = 0;
    server.use(
      http.get('/api/w/:id', ({ params }) => {
        gets++;
        expect(params.id).toBe(WS_ID);
        return HttpResponse.json({ workspace: workspace({ name: 'Home' }) });
      }),
    );
    markLinkSaved(WS_ID);
    await renderApp({ pathname: `/w/${WS_ID}` });
    expect((await nameField()).value).toBe('Home');
    expect(gets).toBe(1);
    await waitFor(() => expect(titleText()).toBe('Todoodle - Home'));
  });

  it('TC-64 a 404 renders NotFound', async () => {
    server.use(http.get('/api/w/:id', () => HttpResponse.json({ error: 'not_found', message: 'Workspace not found' }, { status: 404 })));
    await renderApp({ pathname: `/w/${WS_ID}` });
    expect(await screen.findByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
  });

  it('TC-79 id route: a 500 shows the retry state; Try again refetches once', async () => {
    let gets = 0;
    server.use(
      http.get('/api/w/:id', () =>
        ++gets === 1
          ? HttpResponse.json({ error: 'internal', message: 'x' }, { status: 500 })
          : HttpResponse.json({ workspace: workspace() }),
      ),
    );
    await renderApp({ pathname: `/w/${WS_ID}` });
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this workspace.");
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
    expect((await nameField()).value).toBe('My Todoodle');
    expect(gets).toBe(2);
  });

  it('TC-78 id route: skeleton with aria-busy while GET is pending', async () => {
    const gate = deferred();
    server.use(
      http.get('/api/w/:id', async () => {
        await gate.promise;
        return HttpResponse.json({ workspace: workspace() });
      }),
    );
    await renderApp({ pathname: `/w/${WS_ID}` });
    expect(await screen.findByTestId('workspace-skeleton')).toHaveAttribute('aria-busy', 'true');
    await act(async () => gate.resolve());
    expect((await nameField()).value).toBe('My Todoodle');
  });

  it('TC-93 placeholderData renders its name before GET resolves, no skeleton; GET then replaces it', async () => {
    const gate = deferred();
    server.use(
      http.get('/api/w/:id', async () => {
        await gate.promise;
        return HttpResponse.json({ workspace: workspace({ name: 'Home (renamed)', version: 2 }) });
      }),
    );
    markLinkSaved(WS_ID);
    await act(async () => {
      render(
        <AppProviders>
          <MemoryRouter initialEntries={[`/w/${WS_ID}`]}>
            <WorkspaceById workspaceId={WS_ID} placeholderData={workspace({ name: 'Home' })} />
          </MemoryRouter>
        </AppProviders>,
      );
    });
    expect(screen.getByLabelText<HTMLInputElement>('Workspace name').value).toBe('Home');
    expect(screen.queryByTestId('workspace-skeleton')).not.toBeInTheDocument();
    await act(async () => gate.resolve());
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Workspace name').value).toBe('Home (renamed)'));
  });
});
