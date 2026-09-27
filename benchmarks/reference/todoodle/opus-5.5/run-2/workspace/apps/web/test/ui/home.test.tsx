import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { DROPPED_NOTICE, notifyDropped } from '@/features/remembered/useDroppedNotice';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import {
  A_ID,
  B_ID,
  C_ID,
  handlers,
  rememberedBody,
  rememberedEntry,
  rememberedHandlers,
  SECRET,
  workspace,
  X_ID,
  Y_ID,
} from '../fixtures';
import { server } from '../msw';
import {
  countRequests,
  currentLocation,
  deferred,
  expectNoAxeViolations,
  openMenu,
  renderApp,
  stubHoverNone,
} from '../render';

const HEADING = 'Your workspaces on this browser';
const HINT = 'Have a link? Open it to get back in.';

const startButton = () => screen.getByRole('button', { name: 'Start a new list' });
const isPrimary = (el: HTMLElement) => el.className.includes('bg-primary');

async function renderHome() {
  await renderApp({ pathname: '/' });
}

describe('Home: remembered list', () => {
  it('TC-50 0 entries -> no heading, no Continue; Start is primary; hint about opening a link', async () => {
    await renderHome();
    expect(await screen.findByText(HINT)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: HEADING })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Continue to/ })).not.toBeInTheDocument();
    expect(startButton()).toBeEnabled();
    expect(isPrimary(startButton())).toBe(true);
    await expectNoAxeViolations();
  });

  it('TC-51 3 entries -> rows in response order with relative times', async () => {
    server.use(
      rememberedHandlers.list([
        rememberedEntry(B_ID, 'Work 💼', 0),
        rememberedEntry(A_ID, 'Home', 5),
        rememberedEntry(C_ID, 'Shopping', 60 * 24),
      ]),
    );
    await renderHome();
    const section = (await screen.findByRole('heading', { name: HEADING })).closest('section')!;
    const rows = within(section).getAllByRole('listitem');
    expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual([
      'Work 💼Opened just now',
      'HomeOpened 5 minutes ago',
      'ShoppingOpened yesterday',
    ]);
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('TC-52 an unavailable entry is greyed, labelled Unavailable, has Remove, and is not a link', async () => {
    server.use(rememberedHandlers.list([rememberedEntry(X_ID, null)]));
    await renderHome();
    const label = await screen.findByText('Unavailable');
    const row = label.closest('li')!;
    expect(row.className).toContain('opacity-60');
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(document.querySelector(`a[href="/w/${X_ID}"]`)).toBeNull();
  });

  it('TC-53 3 skeleton rows while loading, then error + Retry; Retry refetches; Start enabled throughout', async () => {
    const gate = deferred();
    let calls = 0;
    server.use(
      http.get('/api/remembered', async () => {
        calls++;
        if (calls === 1) await gate.promise;
        return HttpResponse.json({ error: 'internal', message: 'x' }, { status: 500 });
      }),
    );
    await renderHome();
    const skeleton = screen.getByTestId('remembered-skeleton');
    expect(within(skeleton).getAllByRole('listitem')).toHaveLength(3);
    expect(startButton()).toBeEnabled();
    await act(async () => gate.resolve());
    expect(await screen.findByText("Couldn't load your workspaces")).toBeInTheDocument();
    expect(screen.queryByTestId('remembered-skeleton')).not.toBeInTheDocument();
    expect(startButton()).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls).toBe(2));
    expect(await screen.findByText("Couldn't load your workspaces")).toBeInTheDocument();
    expect(startButton()).toBeEnabled();
  });

  it('TC-54 clicking a row navigates to /w/:id', async () => {
    server.use(rememberedHandlers.list([rememberedEntry(A_ID, 'Home')]), rememberedHandlers.workspaces({ [A_ID]: 'Home' }));
    await renderHome();
    fireEvent.click(await screen.findByRole('link', { name: /^Home\s*Opened/ }));
    await waitFor(() => expect(currentLocation.value?.pathname).toBe(`/w/${A_ID}`));
  });

  it('TC-60 Remove on an unavailable entry sends DELETE without a dialog', async () => {
    const deletes: string[] = [];
    let list = [rememberedEntry(X_ID, null), rememberedEntry(A_ID, 'Home')];
    server.use(
      http.get('/api/remembered', () => HttpResponse.json(rememberedBody(list))),
      http.delete('/api/remembered/:id', ({ params, request }) => {
        deletes.push(`${String(params.id)} ${request.headers.get('X-Todoodle-Client')}`);
        list = list.filter((w) => w.id !== params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderHome();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(deletes).toEqual([`${X_ID} web`]));
    await waitFor(() => expect(screen.queryByText('Unavailable')).not.toBeInTheDocument());
  });
});

describe('Home: Continue to the most recent workspace', () => {
  it('TC-61 [A, B] -> "Continue to A" is primary, Start is secondary; hover/focus prefetches A', async () => {
    server.use(
      rememberedHandlers.list([rememberedEntry(A_ID, 'Alpha'), rememberedEntry(B_ID, 'Beta')]),
      rememberedHandlers.workspaces({ [A_ID]: 'Alpha', [B_ID]: 'Beta' }),
    );
    const prefetch = vi.spyOn(queryClient, 'prefetchQuery');
    await renderHome();
    const cont = await screen.findByRole('link', { name: 'Continue to Alpha' });
    expect(cont).toHaveAttribute('href', `/w/${A_ID}`);
    expect(isPrimary(cont)).toBe(true);
    expect(isPrimary(startButton())).toBe(false);
    expect(startButton().className).toContain('border-border');
    // Order: Continue, then the list, then Start.
    const heading = screen.getByRole('heading', { name: HEADING });
    expect(cont.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(startButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.pointerEnter(cont);
    await waitFor(() =>
      expect(prefetch).toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.workspace(A_ID) })),
    );
    prefetch.mockClear();
    fireEvent.focus(cont);
    expect(prefetch).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['ws', A_ID, 'workspace'] }));
    await expectNoAxeViolations();
  });

  it.each([
    ['all unavailable', 'unavailable'],
    ['loading', 'loading'],
    ['error', 'error'],
  ])('TC-62 %s -> no Continue; Start is primary', async (_label, mode) => {
    const gate = deferred();
    server.use(
      mode === 'unavailable'
        ? rememberedHandlers.list([rememberedEntry(X_ID, null), rememberedEntry(Y_ID, null)])
        : mode === 'loading'
          ? http.get('/api/remembered', async () => {
              await gate.promise;
              return HttpResponse.json(rememberedBody([]));
            })
          : http.get('/api/remembered', () => HttpResponse.json({ error: 'internal', message: 'x' }, { status: 500 })),
    );
    await renderHome();
    if (mode === 'unavailable') await screen.findAllByText('Unavailable');
    if (mode === 'error') await screen.findByText("Couldn't load your workspaces");
    expect(screen.queryByRole('link', { name: /^Continue to/ })).not.toBeInTheDocument();
    expect(isPrimary(startButton())).toBe(true);
    gate.resolve();
  });

  it('TC-62 Continue skips unavailable entries at the top', async () => {
    server.use(rememberedHandlers.list([rememberedEntry(X_ID, null), rememberedEntry(B_ID, 'Beta')]));
    await renderHome();
    expect(await screen.findByRole('link', { name: 'Continue to Beta' })).toHaveAttribute('href', `/w/${B_ID}`);
  });

  it('TC-63 with [A] cached, 1 s passes with no navigation', async () => {
    queryClient.setQueryData(queryKeys.remembered(), rememberedBody([rememberedEntry(A_ID, 'Alpha')]).workspaces);
    server.use(rememberedHandlers.list([rememberedEntry(A_ID, 'Alpha')]));
    await renderHome();
    await screen.findByRole('link', { name: 'Continue to Alpha' });
    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(currentLocation.value?.pathname).toBe('/');
    vi.useRealTimers();
    expect(screen.getByRole('link', { name: 'Continue to Alpha' })).toBeInTheDocument();
  });
});

describe('dropped-at-cap notice', () => {
  it('TC-59 create with dropped 1 shows the toast; dropped 0 does not', async () => {
    server.use(
      http.post('/api/workspaces', () => HttpResponse.json({ workspace: workspace(), secret: SECRET, dropped: 1 }, { status: 201 })),
    );
    await renderHome();
    fireEvent.click(startButton());
    expect(await screen.findByText(DROPPED_NOTICE)).toBeInTheDocument();
  });

  it('TC-59 dropped 0 -> no toast', async () => {
    server.use(handlers.create());
    await renderHome();
    fireEvent.click(startButton());
    await screen.findByRole('dialog', { name: 'Save your link' });
    expect(screen.queryByText(DROPPED_NOTICE)).not.toBeInTheDocument();
  });

  it('TC-59 opening a link with dropped 1 shows it too; notifyDropped(0) never does', async () => {
    server.use(
      http.post('/api/workspaces/open', () => HttpResponse.json({ workspace: workspace(), dropped: 1 })),
      handlers.get(),
    );
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    expect(await screen.findByText(DROPPED_NOTICE)).toBeInTheDocument();
    const toasts = () => screen.queryAllByText(DROPPED_NOTICE).length;
    const before = toasts();
    act(() => notifyDropped(0));
    expect(toasts()).toBe(before);
  });
});

describe('touch and keyboard (TC-71)', () => {
  async function rowTrigger() {
    server.use(rememberedHandlers.list([rememberedEntry(A_ID, 'Alpha')]));
    await renderHome();
    return screen.findByRole('button', { name: 'More actions for Alpha' });
  }

  it('hover: none -> the "..." is visible without hover and sized as a touch target', async () => {
    stubHoverNone(true);
    const trigger = await rowTrigger();
    expect(trigger.className).toContain('touch-target');
    expect(trigger.className).toContain('opacity-100');
    expect(trigger.className.split(' ')).not.toContain('opacity-0');
    await openMenu(trigger);
    const item = await screen.findByRole('menuitem', { name: 'Forget on this browser' });
    expect(item.className).toContain('touch-target');
  });

  it('hover available -> hidden until row hover or focus-within, still reachable by Tab', async () => {
    stubHoverNone(false);
    const trigger = await rowTrigger();
    const classes = trigger.className.split(' ');
    expect(classes).toContain('opacity-0');
    expect(classes).toContain('group-hover:opacity-100');
    expect(classes).toContain('group-focus-within:opacity-100');
    expect(classes).toContain('[@media(hover:none)]:opacity-100');
    expect(trigger.tabIndex).toBe(0);
    const link = screen.getByRole('link', { name: /^Alpha\s*Opened/ });
    expect(link.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
  });
});
