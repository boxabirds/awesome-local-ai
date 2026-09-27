import type { RememberedPublic } from '@todoodle/shared/schemas';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { markLinkSaved } from '@/features/share/linkSaved';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { A_ID, B_ID, C_ID, rememberedBody, rememberedEntry, rememberedHandlers, X_ID } from '../fixtures';
import { server } from '../msw';
import { countRequests, currentLocation, openMenu, renderApp, stubHoverNone } from '../render';

const NAMES = { [A_ID]: 'Alpha', [B_ID]: 'Beta', [C_ID]: 'Gamma' };

function setup(list: RememberedPublic[] = [rememberedEntry(A_ID, 'Alpha'), rememberedEntry(B_ID, 'Beta'), rememberedEntry(C_ID, 'Gamma')]) {
  let current = list;
  server.use(
    http.get('/api/remembered', () => HttpResponse.json(rememberedBody(current))),
    http.delete('/api/remembered/:id', ({ params }) => {
      current = current.filter((w) => w.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    rememberedHandlers.workspaces(NAMES),
  );
}

async function openSwitcher() {
  await openMenu(await screen.findByRole('button', { name: 'Switch workspace' }));
  return screen.findByRole('menu');
}

const workspacePrefetches = (spy: { mock: { calls: unknown[][] } }, id: string) =>
  spy.mock.calls.filter(
    ([opts]) => JSON.stringify((opts as { queryKey: unknown }).queryKey) === JSON.stringify(['ws', id, 'workspace']),
  ).length;

describe('WorkspaceSwitcher', () => {
  it('TC-57 current is checked; pointerenter/focus prefetches once per open, again after reopening', async () => {
    setup([rememberedEntry(B_ID, 'Beta'), rememberedEntry(A_ID, 'Alpha'), rememberedEntry(X_ID, null), rememberedEntry(C_ID, 'Gamma')]);
    await renderApp({ pathname: `/w/${B_ID}` });
    await screen.findByDisplayValue('Beta');
    await waitFor(() => expect(queryClient.getQueryData(queryKeys.remembered())).toHaveLength(4));
    const prefetch = vi.spyOn(queryClient, 'prefetchQuery');

    let menu = await openSwitcher();
    const items = within(menu).getAllByRole('menuitemcheckbox');
    // Unavailable entries are left out.
    expect(items.map((i) => i.textContent)).toEqual(['Beta', 'Alpha', 'Gamma']);
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Beta' })).toHaveAttribute('aria-checked', 'true');
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'false');
    expect(within(menu).getByRole('menuitem', { name: 'Forget this workspace on this browser' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'All workspaces' })).toBeInTheDocument();

    const alpha = within(menu).getByRole('menuitemcheckbox', { name: 'Alpha' });
    fireEvent.pointerEnter(alpha);
    fireEvent.pointerEnter(alpha);
    fireEvent.focus(alpha);
    expect(workspacePrefetches(prefetch, A_ID)).toBe(1);
    // Keyboard focus on another item warms that one.
    fireEvent.focus(within(menu).getByRole('menuitemcheckbox', { name: 'Gamma' }));
    expect(workspacePrefetches(prefetch, C_ID)).toBe(1);
    expect(workspacePrefetches(prefetch, B_ID)).toBe(0);

    await act(async () => {
      fireEvent.keyDown(menu, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    menu = await openSwitcher();
    fireEvent.pointerEnter(within(menu).getByRole('menuitemcheckbox', { name: 'Alpha' }));
    expect(workspacePrefetches(prefetch, A_ID)).toBe(2);

    // Selecting navigates by id.
    await act(async () => {
      fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Alpha' }));
    });
    await waitFor(() => expect(currentLocation.value?.pathname).toBe(`/w/${A_ID}`));
    expect(await screen.findByDisplayValue('Alpha')).toBeInTheDocument();
  });

  it('TC-58 forgetting the current workspace goes Home', async () => {
    setup();
    markLinkSaved(B_ID);
    await renderApp({ pathname: `/w/${B_ID}` });
    await screen.findByDisplayValue('Beta');
    const menu = await openSwitcher();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Forget this workspace on this browser' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Forget Beta on this browser?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Forget' }));
    await waitFor(() => expect(currentLocation.value?.pathname).toBe('/'));
    await screen.findByRole('heading', { name: 'Your workspaces on this browser' });
    expect(screen.queryByRole('link', { name: /^Beta/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Alpha\s*Opened/ })).toBeInTheDocument();
  });

  it('list error -> only the current workspace and "All workspaces"', async () => {
    server.use(
      http.get('/api/remembered', () => HttpResponse.json({ error: 'internal', message: 'x' }, { status: 500 })),
      rememberedHandlers.workspaces(NAMES),
    );
    await renderApp({ pathname: `/w/${B_ID}` });
    await screen.findByDisplayValue('Beta');
    const menu = await openSwitcher();
    expect(within(menu).getAllByRole('menuitemcheckbox').map((i) => i.textContent)).toEqual(['Beta']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'All workspaces' }));
    await waitFor(() => expect(currentLocation.value?.pathname).toBe('/'));
  });

  it('TC-71 switcher trigger, items and dialog buttons are touch targets', async () => {
    stubHoverNone(true);
    setup();
    await renderApp({ pathname: `/w/${B_ID}` });
    await screen.findByDisplayValue('Beta');
    expect(screen.getByRole('button', { name: 'Switch workspace' }).className).toContain('touch-target');
    const menu = await openSwitcher();
    for (const item of [...within(menu).getAllByRole('menuitemcheckbox'), ...within(menu).getAllByRole('menuitem')]) {
      expect(item.className).toContain('touch-target');
    }
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Forget this workspace on this browser' }));
    const dialog = await screen.findByRole('alertdialog');
    for (const button of within(dialog).getAllByRole('button')) expect(button.className).toContain('touch-target');
  });
});

describe('query keys (TC-73)', () => {
  it('list is ["remembered"], touch is ["remembered-touch", id]; invalidations stay separate', async () => {
    setup();
    const lists = countRequests('GET', /^\/api\/remembered$/);
    const touches = countRequests('POST', /^\/api\/remembered\/[^/]+\/touch$/);
    await renderApp({ pathname: `/w/${A_ID}` });
    await screen.findByDisplayValue('Alpha');
    await waitFor(() => expect(touches.count).toBe(1));
    // The touch success invalidates the list once; let that settle.
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    await new Promise((r) => setTimeout(r, 20));

    const keys = queryClient
      .getQueryCache()
      .findAll()
      .map((q) => JSON.stringify(q.queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify(['remembered']),
        JSON.stringify(['remembered-touch', A_ID]),
        JSON.stringify(['ws', A_ID, 'workspace']),
      ]),
    );

    const listsBefore = lists.count;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.root(A_ID) });
    });
    expect(lists.count).toBe(listsBefore);

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.remembered() });
    });
    expect(lists.count).toBe(listsBefore + 1);
    expect(touches.count).toBe(1);
  });
});
