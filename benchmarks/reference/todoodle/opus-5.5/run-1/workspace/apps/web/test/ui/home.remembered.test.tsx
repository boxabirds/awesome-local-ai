import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';
import { CreateWorkspaceResponse, OpenWorkspaceResponse } from '@todoodle/shared/schemas';
import { DROPPED_NOTICE } from '@/features/remembered/useDroppedNotice';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { server } from '../msw.ts';
import { SECRET, WORKSPACE, gate, recordRequests } from '../support/fixtures.ts';
import {
  A,
  B,
  C,
  X,
  Y,
  cacheRemembered,
  expectNoAxeViolations,
  forgetHandler,
  rememberedHandler,
  stubHoverNone,
  workspaceFor,
  workspacesHandler,
} from '../support/remembered.ts';
import { currentLocation, renderApp } from '../support/render.tsx';

const HEADING = 'Your workspaces on this browser';
const HINT = 'Have a link? Open it to get back in.';

const startButton = () => screen.getByRole('button', { name: 'Start a new list' });
const continueLink = () => screen.queryByRole('link', { name: /^Continue to/ });
const rows = () => within(screen.getByRole('region', { name: HEADING })).getAllByRole('listitem');

function prefetchedKeys(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map((call) => JSON.stringify((call[0] as { queryKey: unknown }).queryKey));
}

describe('home.remembered_list', () => {
  it('TC-50 nothing remembered: no heading, no Continue; Start is primary; the link hint shows', async () => {
    server.use(rememberedHandler([]));
    await renderApp('/');
    expect(await screen.findByText(HINT)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: HEADING })).toBeNull();
    expect(continueLink()).toBeNull();
    expect(startButton()).toHaveAttribute('data-variant', 'primary');
    expect(startButton()).toBeEnabled();
    await expectNoAxeViolations();
  });

  it('TC-51 rows in response order with relative last-opened times', async () => {
    server.use(rememberedHandler([A, B, C]));
    await renderApp('/');
    await screen.findByRole('heading', { name: HEADING });
    const links = rows().map((row) => within(row).getByRole('link'));
    expect(links.map((link) => link.textContent)).toEqual([
      'Groceries 🛒just now',
      'Café work2 hours ago',
      'Holidayyesterday',
    ]);
    await expectNoAxeViolations();
  });

  it('TC-52 an unavailable entry is greyed, labelled Unavailable, has Remove, and is not a link', async () => {
    server.use(rememberedHandler([X]));
    await renderApp('/');
    const row = (await screen.findByText('Unavailable')).closest('li')!;
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row.className).toContain('opacity-60');
    expect(within(row).queryByRole('link')).toBeNull();
    expect(within(row).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('TC-53 3 skeleton rows while loading, then error + Retry; Retry refetches; Start enabled throughout', async () => {
    const hold = gate();
    let requests = 0;
    server.use(rememberedHandler([], { status: 500, until: hold.promise, onRequest: () => requests++ }));
    const { user } = await renderApp('/');
    expect(screen.getByLabelText('Loading your workspaces')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByTestId('remembered-skeleton-row')).toHaveLength(3);
    expect(startButton()).toBeEnabled();
    await act(async () => hold.release());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your workspaces");
    expect(startButton()).toBeEnabled();
    expect(requests).toBe(1);

    server.use(rememberedHandler([A]));
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: HEADING })).toBeInTheDocument();
    expect(requests).toBe(1);
    expect(startButton()).toBeEnabled();
  });

  it('TC-54 clicking a row opens /w/:id', async () => {
    server.use(rememberedHandler([A]), workspacesHandler([workspaceFor(A)]));
    const { user } = await renderApp('/');
    await screen.findByRole('heading', { name: HEADING });
    await user.click(within(rows()[0]!).getByRole('link'));
    await waitFor(() => expect(currentLocation.value?.pathname).toBe(`/w/${A.id}`));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Workspace name' })).toHaveValue(A.name));
  });

  it('TC-60 Remove on an unavailable entry sends DELETE without a dialog', async () => {
    const deleted: string[] = [];
    server.use(
      rememberedHandler([X, A]),
      forgetHandler({
        onRequest: (id) => {
          deleted.push(id);
          server.use(rememberedHandler([A]));
        },
      }),
    );
    const { user } = await renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(deleted).toEqual([X.id]));
    expect(screen.queryByText('Unavailable')).toBeNull();
  });

  it('TC-71 row menu trigger: touch-target sizing, visible without hover on touch, hover/focus-within on mouse, reachable by Tab', async () => {
    for (const hoverNone of [true, false]) {
      stubHoverNone(hoverNone);
      server.use(rememberedHandler([A]));
      const { user, unmount } = await renderApp('/');
      await screen.findByRole('heading', { name: HEADING });
      const trigger = screen.getByRole('button', { name: `More actions for ${A.name}` });
      const classes = trigger.className.split(/\s+/);
      expect(window.matchMedia('(hover: none)').matches).toBe(hoverNone);
      // (hover: none): always visible and at least 44px; with a mouse: hidden until row hover or focus-within.
      expect(classes).toEqual(
        expect.arrayContaining(['touch-target', '[@media(hover:none)]:opacity-100', 'opacity-0', 'group-hover:opacity-100', 'group-focus-within:opacity-100']),
      );
      expect(within(rows()[0]!).getByRole('link').className).toContain('touch-target');
      // Keyboard: Tab reaches the row link, then its menu trigger.
      const link = within(rows()[0]!).getByRole('link');
      link.focus();
      await user.tab();
      expect(trigger).toHaveFocus();
      unmount();
      queryClient.clear();
    }
  });
});

describe('home.continue_recent', () => {
  it('TC-61 [A, B] -> "Continue to A" is primary, Start is secondary; hover/focus prefetches A', async () => {
    server.use(rememberedHandler([A, B]), workspacesHandler([workspaceFor(A), workspaceFor(B)]));
    const prefetch = vi.spyOn(queryClient, 'prefetchQuery');
    const { user } = await renderApp('/');
    const cont = await screen.findByRole('link', { name: `Continue to ${A.name}` });
    expect(cont).toHaveAttribute('data-variant', 'primary');
    expect(cont).toHaveAttribute('href', `/w/${A.id}`);
    expect(startButton()).toHaveAttribute('data-variant', 'secondary');
    expect(prefetchedKeys(prefetch)).not.toContain(JSON.stringify(queryKeys.workspace(A.id)));
    await user.hover(cont);
    expect(prefetchedKeys(prefetch)).toContain(JSON.stringify(queryKeys.workspace(A.id)));
    prefetch.mockClear();
    cont.focus();
    expect(prefetchedKeys(prefetch)).toContain(JSON.stringify(queryKeys.workspace(A.id)));
  });

  it('TC-62 no Continue when all entries are unavailable, while loading, or on error; Start stays primary', async () => {
    server.use(rememberedHandler([X, Y]));
    const first = await renderApp('/');
    await waitFor(() => expect(screen.getAllByText('Unavailable')).toHaveLength(2));
    expect(continueLink()).toBeNull();
    expect(startButton()).toHaveAttribute('data-variant', 'primary');
    first.unmount();
    queryClient.clear();

    const hold = gate();
    server.use(rememberedHandler([A], { until: hold.promise }));
    const second = await renderApp('/');
    expect(screen.getByLabelText('Loading your workspaces')).toBeInTheDocument();
    expect(continueLink()).toBeNull();
    expect(startButton()).toHaveAttribute('data-variant', 'primary');
    second.unmount();
    hold.release();
    queryClient.clear();

    server.use(rememberedHandler([], { status: 500 }));
    await renderApp('/');
    await screen.findByRole('alert');
    expect(continueLink()).toBeNull();
    expect(startButton()).toHaveAttribute('data-variant', 'primary');
  });

  it('TC-63 Home never navigates by itself', async () => {
    cacheRemembered([A]);
    await renderApp('/');
    expect(continueLink()).toBeInTheDocument();
    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(currentLocation.value?.pathname).toBe('/');
    expect(screen.getByRole('link', { name: `Continue to ${A.name}` })).toBeInTheDocument();
  });
});

describe('remembered.cap_notice', () => {
  it('TC-59 opening a link that pushed the oldest off the list shows the notice; dropped 0 does not', async () => {
    for (const dropped of [0, 1]) {
      server.use(
        http.post('/api/workspaces/open', () => HttpResponse.json(OpenWorkspaceResponse.parse({ workspace: WORKSPACE, dropped }))),
        http.get('/api/w/:id', () => HttpResponse.json({ workspace: WORKSPACE })),
      );
      const { unmount } = await renderApp(`/w#${SECRET}`);
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Workspace name' })).toHaveValue(WORKSPACE.name));
      if (dropped) expect(await screen.findByText(DROPPED_NOTICE)).toBeInTheDocument();
      else expect(screen.queryByText(DROPPED_NOTICE)).toBeNull();
      unmount();
      toast.dismiss();
      queryClient.clear();
      const { resetOpensForTests } = await import('@/features/workspace/bootOpen');
      resetOpensForTests();
    }
  });

  it('TC-59 creating at the cap shows the notice', async () => {
    server.use(
      http.post('/api/workspaces', () => HttpResponse.json(CreateWorkspaceResponse.parse({ workspace: WORKSPACE, secret: SECRET, dropped: 1 }), { status: 201 })),
    );
    const { user } = await renderApp('/');
    expect(screen.queryByText(DROPPED_NOTICE)).toBeNull();
    await user.click(startButton());
    expect(await screen.findByText(DROPPED_NOTICE)).toBeInTheDocument();
  });
});

describe('query keys (TC-73)', () => {
  it('list uses ["remembered"], touch ["remembered-touch", id]; invalidations stay isolated', async () => {
    const seen = recordRequests();
    cacheRemembered([A, B]);
    server.use(rememberedHandler([A, B]), workspacesHandler([workspaceFor(A), workspaceFor(B)]));
    const { user } = await renderApp(`/w/${A.id}`);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Workspace name' })).toHaveValue(A.name));
    // Open the switcher so the browser-scoped list query is mounted next to the touch query.
    await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
    await screen.findByRole('menu');
    await waitFor(() => expect(seen.filter((r) => r === `POST /api/remembered/${A.id}/touch`)).toHaveLength(1));

    const keys = queryClient.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey));
    expect(keys).toEqual(expect.arrayContaining([JSON.stringify(['remembered']), JSON.stringify(['remembered-touch', A.id])]));
    expect(queryKeys.remembered()).toEqual(['remembered']);
    expect(queryKeys.rememberedTouch(A.id)).toEqual(['remembered-touch', A.id]);

    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    seen.length = 0;
    await act(() => queryClient.invalidateQueries({ queryKey: queryKeys.root(A.id) }));
    expect(seen).not.toContain('GET /api/remembered');
    expect(seen).toContain(`GET /api/w/${A.id}`);

    seen.length = 0;
    await act(() => queryClient.invalidateQueries({ queryKey: queryKeys.remembered() }));
    expect(seen).toEqual(['GET /api/remembered']);
  });
});
