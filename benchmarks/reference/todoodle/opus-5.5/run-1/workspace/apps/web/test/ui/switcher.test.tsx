import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { server } from '../msw.ts';
import { recordRequests } from '../support/fixtures.ts';
import {
  A,
  B,
  C,
  X,
  cacheRemembered,
  forgetHandler,
  markSaved,
  rememberedHandler,
  stubHoverNone,
  workspaceFor,
  workspacesHandler,
} from '../support/remembered.ts';
import { currentLocation, renderApp } from '../support/render.tsx';

type User = Awaited<ReturnType<typeof renderApp>>['user'];

/** /w/B with [A, B, C, unavailable X] remembered. */
async function enterB() {
  server.use(rememberedHandler([A, B, C, X]), workspacesHandler([workspaceFor(A), workspaceFor(B), workspaceFor(C)]));
  const rendered = await renderApp(`/w/${B.id}`);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Workspace name' })).toHaveValue(B.name));
  return rendered;
}

async function openMenu(user: User) {
  await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
  const menu = await screen.findByRole('menu');
  await within(menu).findByRole('menuitem', { name: A.name! });
  return menu;
}

function prefetchCount(spy: { mock: { calls: unknown[][] } }, id: string) {
  const key = JSON.stringify(queryKeys.workspace(id));
  return spy.mock.calls.filter((call) => JSON.stringify((call[0] as { queryKey: unknown }).queryKey) === key).length;
}

describe('switcher.menu', () => {
  it('TC-57 lists available workspaces with the current one marked; hover/focus prefetches once per open', async () => {
    const { user } = await enterB();
    const prefetch = vi.spyOn(queryClient, 'prefetchQuery');
    let menu = await openMenu(user);
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      A.name,
      B.name,
      C.name,
      'Forget this workspace on this browser',
      'All workspaces',
    ]);
    expect(within(menu).getByRole('menuitem', { name: B.name! })).toHaveAttribute('aria-current', 'page');
    expect(within(menu).getByRole('menuitem', { name: A.name! })).not.toHaveAttribute('aria-current');

    const itemA = within(menu).getByRole('menuitem', { name: A.name! });
    await user.hover(itemA);
    itemA.focus();
    await user.unhover(itemA);
    await user.hover(itemA);
    expect(prefetchCount(prefetch, A.id)).toBe(1);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    menu = await openMenu(user);
    // Keyboard: focus alone prefetches too.
    within(menu).getByRole('menuitem', { name: A.name! }).focus();
    expect(prefetchCount(prefetch, A.id)).toBe(2);
  });

  it('TC-57 selecting another workspace opens it', async () => {
    const { user } = await enterB();
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: A.name! }));
    await waitFor(() => expect(currentLocation.value?.pathname).toBe(`/w/${A.id}`));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Workspace name' })).toHaveValue(A.name));
  });

  it('TC-58 forgetting the current workspace goes Home', async () => {
    markSaved(B.id);
    const deleted: string[] = [];
    server.use(forgetHandler({ onRequest: (id) => deleted.push(id) }));
    const { user } = await enterB();
    server.use(forgetHandler({ onRequest: (id) => deleted.push(id) }));
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Forget this workspace on this browser' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading', { name: `Forget ${B.name} on this browser?` })).toBeInTheDocument();
    server.use(rememberedHandler([A, C]));
    await user.click(within(dialog).getByRole('button', { name: 'Forget' }));
    await waitFor(() => expect(currentLocation.value?.pathname).toBe('/'));
    expect(deleted).toEqual([B.id]);
  });

  it('"All workspaces" goes Home', async () => {
    const { user } = await enterB();
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'All workspaces' }));
    await waitFor(() => expect(currentLocation.value?.pathname).toBe('/'));
  });

  it('list error -> only the current workspace and "All workspaces"', async () => {
    server.use(workspacesHandler([workspaceFor(B)]), rememberedHandler([], { status: 500 }));
    const { user } = await renderApp(`/w/${B.id}`);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Workspace name' })).toHaveValue(B.name));
    await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
    const menu = await screen.findByRole('menu');
    await waitFor(() =>
      expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([B.name, 'All workspaces']),
    );
  });

  it('TC-71 switcher items use touch-target sizing; the trigger is always visible', async () => {
    stubHoverNone(true);
    const { user } = await enterB();
    const trigger = screen.getByRole('button', { name: 'Switch workspace' });
    expect(trigger.className).toContain('touch-target');
    expect(trigger.className).not.toContain('opacity-0');
    const menu = await openMenu(user);
    for (const item of within(menu).getAllByRole('menuitem')) expect(item.className).toContain('touch-target');
  });

  it('does not refetch the list for an already-cached browser list and never lists unavailable entries', async () => {
    cacheRemembered([A, B, X]);
    const seen = recordRequests();
    const { user } = await enterB();
    const menu = await openMenu(user);
    expect(within(menu).queryByText('Unavailable')).toBeNull();
    expect(seen.filter((r) => r === 'GET /api/remembered').length).toBeLessThanOrEqual(1);
  });
});
