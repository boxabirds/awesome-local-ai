import { useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NAME_HINT_MS } from '@todoodle/shared/limits';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { primeOpen } from '@/features/workspace/bootOpen';
import { workspaceQuery } from '@/features/workspace/workspaceQuery';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { loadWorkspaceRoute } from '@/routes/lazy';
import { server } from '../msw.ts';
import { SECRET, WORKSPACE, gate, getHandler, openHandler, recordRequests } from '../support/fixtures.ts';
import { Providers, currentLocation, renderApp } from '../support/render.tsx';

const ID = WORKSPACE.id;

/** The /w#secret route with the workspace already known (as right after create): no requests. */
async function renderPrimed(path = `/w#${SECRET}`) {
  queryClient.setQueryData(queryKeys.workspace(ID), WORKSPACE);
  primeOpen(SECRET, WORKSPACE);
  // Mark the link saved so the banner stays out of the way of these tests.
  localStorage.setItem(`tdl:v1:linkSaved:${ID}`, '1');
  await loadWorkspaceRoute();
  const rendered = await renderApp(path);
  await screen.findByRole('textbox', { name: 'Workspace name' });
  return rendered;
}

function nameInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Workspace name' });
}

function titleText(): string | null | undefined {
  return document.head.querySelector('title')?.textContent;
}

function patchHandler(onBody: (body: unknown) => void, opts: { status?: number; until?: Promise<unknown> } = {}) {
  return http.patch('/api/w/:id', async ({ request }) => {
    const body = (await request.json()) as { name: string };
    onBody(body);
    await opts.until;
    if (opts.status && opts.status !== 200) return HttpResponse.json({ error: 'internal', message: 'x' }, { status: opts.status });
    return HttpResponse.json({ workspace: { ...WORKSPACE, name: body.name, version: WORKSPACE.version + 1 } });
  });
}

describe('web.workspace_shell: /w#secret', () => {
  it('TC-47 opens with the secret, shows the name, and leaves the hash unchanged', async () => {
    const bodies: unknown[] = [];
    server.use(openHandler({ onRequest: (body) => bodies.push(body) }));
    await renderApp(`/w#${SECRET}`);
    await waitFor(() => expect(nameInput()).toHaveValue('My Todoodle'));
    expect(bodies).toEqual([{ secret: SECRET }]);
    expect(currentLocation.value?.pathname).toBe('/w');
    expect(currentLocation.value?.hash).toBe(`#${SECRET}`);
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
  });

  it('TC-48 edit + Enter shows the new name before PATCH resolves; PATCH gets the trimmed name', async () => {
    const hold = gate();
    const bodies: unknown[] = [];
    server.use(patchHandler((body) => bodies.push(body), { until: hold.promise }), getHandler({ workspace: { ...WORKSPACE, name: 'Groceries', version: 2 } }));
    const { user } = await renderPrimed();
    await user.clear(nameInput());
    await user.type(nameInput(), '  Groceries  {Enter}');
    expect(nameInput()).toHaveValue('Groceries');
    await waitFor(() => expect(bodies).toEqual([{ name: 'Groceries' }]));
    expect(queryClient.getQueryData<{ name: string }>(queryKeys.workspace(ID))?.name).toBe('Groceries');
    expect(titleText()).toBe('Todoodle - Groceries');
    hold.release();
    await waitFor(() => expect(queryClient.getQueryData<{ version: number }>(queryKeys.workspace(ID))?.version).toBe(2));
    expect(nameInput()).toHaveValue('Groceries');
  });

  it("TC-49 an empty name restores the previous one, sends no PATCH, and shows 'Name can't be empty'", async () => {
    const seen = recordRequests();
    const { user } = await renderPrimed();
    await user.clear(nameInput());
    await user.type(nameInput(), '   {Enter}');
    expect(nameInput()).toHaveValue('My Todoodle');
    expect(screen.getByRole('status', { name: '' })).toBeDefined();
    expect(screen.getByText("Name can't be empty")).toHaveAttribute('role', 'status');
    expect(seen).toEqual([]);
  });

  it('TC-50 PATCH 500 restores the previous name and shows an error toast', async () => {
    server.use(patchHandler(() => {}, { status: 500 }), getHandler());
    const { user } = await renderPrimed();
    await user.clear(nameInput());
    await user.type(nameInput(), 'Doomed{Enter}');
    expect(await screen.findByText("Couldn't rename the workspace — try again")).toBeInTheDocument();
    await waitFor(() => expect(nameInput()).toHaveValue('My Todoodle'));
    expect(queryClient.getQueryData<{ name: string }>(queryKeys.workspace(ID))?.name).toBe('My Todoodle');
  });

  it('Escape cancels an edit without a request', async () => {
    const seen = recordRequests();
    const { user } = await renderPrimed();
    await user.clear(nameInput());
    await user.type(nameInput(), 'Draft{Escape}');
    expect(nameInput()).toHaveValue('My Todoodle');
    expect(seen).toEqual([]);
  });

  it("TC-51 a <title> renders 'Todoodle - <name>' and never contains the secret, panel open or closed", async () => {
    const { user } = await renderPrimed();
    expect(titleText()).toBe('Todoodle - My Todoodle');
    expect(document.title).toBe('Todoodle - My Todoodle');
    await user.click(screen.getByRole('button', { name: 'Share' }));
    await screen.findByRole('dialog');
    expect(titleText()).not.toContain(SECRET);
    expect(document.title).not.toContain(SECRET);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.title).toBe('Todoodle - My Todoodle');
  });

  it('TC-78 while open is pending: skeleton with aria-busy, no NotFound; with a primed cache the name renders at once', async () => {
    const hold = gate();
    server.use(openHandler({ until: hold.promise }));
    await renderApp(`/w#${SECRET}`);
    expect(await screen.findByLabelText('Loading workspace')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Workspace not found')).toBeNull();
    hold.release();
    await waitFor(() => expect(nameInput()).toHaveValue('My Todoodle'));
    expect(screen.queryByLabelText('Loading workspace')).toBeNull();
  });

  it('TC-78 primed (just created): the name renders immediately with no skeleton', async () => {
    await loadWorkspaceRoute();
    queryClient.setQueryData(queryKeys.workspace(ID), WORKSPACE);
    primeOpen(SECRET, WORKSPACE);
    localStorage.setItem(`tdl:v1:linkSaved:${ID}`, '1');
    const seen = recordRequests();
    await renderApp(`/w#${SECRET}`);
    expect(screen.queryByLabelText('Loading workspace')).toBeNull();
    expect(nameInput()).toHaveValue('My Todoodle');
    expect(seen).toEqual([]);
  });

  it.each([
    ['5xx', () => HttpResponse.json({ error: 'internal', message: 'x' }, { status: 500 })],
    ['network', () => HttpResponse.error()],
  ])("TC-79 open %s -> 'Couldn't load this workspace.' + Try again; Try again issues exactly one request", async (_label, failure) => {
    let calls = 0;
    server.use(
      http.post('/api/workspaces/open', () => {
        calls++;
        return failure();
      }),
    );
    const { user } = await renderApp(`/w#${SECRET}`);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load this workspace.");
    expect(screen.queryByText('Workspace not found')).toBeNull();
    expect(calls).toBe(1);

    server.use(openHandler({ onRequest: () => calls++ }));
    // Async act: the retry suspends on a new open promise (see renderApp).
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Try again' }));
    });
    await waitFor(() => expect(nameInput()).toHaveValue('My Todoodle'));
    expect(calls).toBe(2);
  });

  it('TC-79 open 404 renders NotFound, not the retry state', async () => {
    server.use(http.post('/api/workspaces/open', () => HttpResponse.json({ error: 'not_found', message: 'Workspace not found' }, { status: 404 })));
    await renderApp(`/w#${SECRET}`);
    expect(await screen.findByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load this workspace.")).toBeNull();
  });

  it('TC-80 an unchanged name sends no PATCH; the hint shows for NAME_HINT_MS (2,499 visible / 2,501 gone)', async () => {
    const seen = recordRequests();
    await renderPrimed();
    const input = nameInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'My Todoodle' } });
    fireEvent.blur(input);
    expect(seen).toEqual([]);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(screen.getByText("Name can't be empty")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(NAME_HINT_MS - 1));
    expect(screen.getByText("Name can't be empty")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2));
    expect(screen.queryByText("Name can't be empty")).toBeNull();
    expect(seen).toEqual([]);
  });

  it('TC-81 no code writes document.title directly', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
    const setter = vi.fn();
    Object.defineProperty(document, 'title', {
      configurable: true,
      get: () => descriptor?.get?.call(document),
      set: setter,
    });
    try {
      const { user } = await renderPrimed();
      await user.click(screen.getByRole('button', { name: 'Share' }));
      await screen.findByRole('dialog');
      await renderApp('/');
      expect(setter).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, 'title');
    }
  });
});

describe('web.workspace_shell: /w/:workspaceId', () => {
  it('TC-64 renders from GET /api/w/:id; the title has no secret', async () => {
    const seen = recordRequests();
    server.use(getHandler());
    await renderApp(`/w/${ID}`);
    await waitFor(() => expect(nameInput()).toHaveValue('My Todoodle'));
    expect(seen).toEqual([`GET /api/w/${ID}`]);
    expect(titleText()).toBe('Todoodle - My Todoodle');
    expect(titleText()).not.toContain(SECRET);
  });

  it('TC-64 GET 404 renders NotFound', async () => {
    server.use(http.get('/api/w/:id', () => HttpResponse.json({ error: 'not_found', message: 'Workspace not found' }, { status: 404 })));
    await renderApp(`/w/${ID}`);
    expect(await screen.findByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
  });

  it('TC-78 while GET is pending: skeleton with aria-busy and no NotFound', async () => {
    const hold = gate();
    server.use(getHandler({ until: hold.promise }));
    await renderApp(`/w/${ID}`);
    expect(screen.getByLabelText('Loading workspace')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Workspace not found')).toBeNull();
    hold.release();
    await waitFor(() => expect(nameInput()).toHaveValue('My Todoodle'));
  });

  it('TC-79 GET 5xx -> load failed; Try again issues exactly one request', async () => {
    let calls = 0;
    server.use(
      http.get('/api/w/:id', () => {
        calls++;
        return HttpResponse.json({ error: 'internal', message: 'x' }, { status: 503 });
      }),
    );
    const { user } = await renderApp(`/w/${ID}`);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this workspace.");
    expect(calls).toBe(1);
    server.use(getHandler({ onRequest: () => calls++ }));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(nameInput()).toHaveValue('My Todoodle'));
    expect(calls).toBe(2);
  });

  it('TC-93 placeholderData renders its name before GET resolves, then the GET result replaces it', async () => {
    const hold = gate();
    server.use(getHandler({ until: hold.promise }));
    function Probe() {
      const { data } = useQuery(workspaceQuery(ID, { placeholderData: { ...WORKSPACE, name: 'Home' } }));
      return <p>{data ? data.name : 'skeleton'}</p>;
    }
    render(
      <Providers entry="/">
        <Probe />
      </Providers>,
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('skeleton')).toBeNull();
    hold.release();
    expect(await screen.findByText('My Todoodle')).toBeInTheDocument();
  });
});
