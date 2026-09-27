import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { A_ID, B_ID, NOT_FOUND_BODY, rememberedBody, rememberedEntry, rememberedHandlers, SECRET, workspace, X_ID } from '../fixtures';
import { server } from '../msw';
import { deferred, expectNoAxeViolations, renderApp } from '../render';

const TIP = "Links are long — check it wasn't cut off when it was copied.";
const HEADING = 'Your workspaces on this browser';

describe('NotFound recovery slot (TC-69)', () => {
  it('2 entries -> the list with its heading above Start a new list; story 2 text kept', async () => {
    server.use(
      rememberedHandlers.list([rememberedEntry(A_ID, 'Alpha'), rememberedEntry(X_ID, null)]),
      handlers404(),
    );
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    const heading = await screen.findByRole('heading', { name: HEADING });
    const start = screen.getByRole('button', { name: 'Start a new list' });
    expect(heading.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
    expect(screen.getByText(TIP)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Alpha\s*Opened/ })).toHaveAttribute('href', `/w/${A_ID}`);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    // Nothing about the bad link itself.
    expect(document.body.textContent).not.toContain(SECRET);
    await expectNoAxeViolations();
  });

  it('0 entries -> nothing in the slot (no heading, no hint)', async () => {
    await renderApp({ pathname: '/nope' });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('heading', { name: HEADING })).not.toBeInTheDocument();
    expect(screen.queryByText('Have a link? Open it to get back in.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('remembered-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText(TIP)).toBeInTheDocument();
  });

  it('loading -> skeleton rows', async () => {
    const gate = deferred();
    server.use(
      http.get('/api/remembered', async () => {
        await gate.promise;
        return HttpResponse.json(rememberedBody([]));
      }),
    );
    await renderApp({ pathname: '/nope' });
    expect(screen.getByTestId('remembered-skeleton')).toBeInTheDocument();
    expect(screen.getByText(TIP)).toBeInTheDocument();
    await act(async () => gate.resolve());
    await waitFor(() => expect(screen.queryByTestId('remembered-skeleton')).not.toBeInTheDocument());
  });

  it('error -> nothing in the slot, no alert', async () => {
    server.use(http.get('/api/remembered', () => HttpResponse.json({ error: 'internal', message: 'x' }, { status: 500 })));
    await renderApp({ pathname: '/nope' });
    await waitFor(() => expect(screen.queryByTestId('remembered-skeleton')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your workspaces")).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: HEADING })).not.toBeInTheDocument();
    expect(screen.getByText(TIP)).toBeInTheDocument();
  });
});

function handlers404() {
  return http.post('/api/workspaces/open', () => HttpResponse.json(NOT_FOUND_BODY, { status: 404 }));
}

describe('instant workspace name (TC-70)', () => {
  const cached = () => [rememberedEntry(A_ID, 'Alpha'), rememberedEntry(B_ID, 'Beta')];

  function primeList() {
    queryClient.setQueryData(queryKeys.remembered(), rememberedBody(cached()).workspaces);
    server.use(rememberedHandlers.list(cached()));
  }

  it('header shows the cached name before GET resolves, body is a skeleton; real data replaces it', async () => {
    primeList();
    const gate = deferred();
    server.use(
      http.get('/api/w/:id', async () => {
        await gate.promise;
        return HttpResponse.json({ workspace: workspace({ id: A_ID, name: 'Alpha (renamed)' }) });
      }),
    );
    await renderApp({ pathname: `/w/${A_ID}` });
    const banner = screen.getByRole('banner');
    expect(within(banner).getByLabelText<HTMLInputElement>('Workspace name').value).toBe('Alpha');
    expect(screen.getByTestId('workspace-body-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-skeleton')).not.toBeInTheDocument();
    expect(queryClient.getQueryData(queryKeys.workspace(A_ID))).toBeUndefined();

    await act(async () => gate.resolve());
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Workspace name').value).toBe('Alpha (renamed)'));
    expect(screen.queryByTestId('workspace-body-skeleton')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
  });

  it('a 404 drops the placeholder and shows NotFound', async () => {
    primeList();
    const gate = deferred();
    server.use(
      http.get('/api/w/:id', async () => {
        await gate.promise;
        return HttpResponse.json(NOT_FOUND_BODY, { status: 404 });
      }),
    );
    await renderApp({ pathname: `/w/${A_ID}` });
    expect(screen.getByLabelText<HTMLInputElement>('Workspace name').value).toBe('Alpha');
    await act(async () => gate.resolve());
    expect(await screen.findByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Workspace name')).not.toBeInTheDocument();
    expect(queryClient.getQueryData(queryKeys.workspace(A_ID))).toBeUndefined();
  });

  it('a network error shows "Couldn\'t load this workspace" with Try again', async () => {
    primeList();
    server.use(http.get('/api/w/:id', () => HttpResponse.error()));
    await renderApp({ pathname: `/w/${A_ID}` });
    expect(await screen.findByText("Couldn't load this workspace.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Workspace name')).not.toBeInTheDocument();
  });

  it('cold load (nothing cached) -> the full skeleton, no name', async () => {
    const gate = deferred();
    server.use(
      http.get('/api/w/:id', async () => {
        await gate.promise;
        return HttpResponse.json({ workspace: workspace({ id: A_ID, name: 'Alpha' }) });
      }),
    );
    await renderApp({ pathname: `/w/${A_ID}` });
    expect(screen.getByTestId('workspace-skeleton')).toBeInTheDocument();
    expect(screen.queryByLabelText('Workspace name')).not.toBeInTheDocument();
    await act(async () => gate.resolve());
    expect(await screen.findByDisplayValue('Alpha')).toBeInTheDocument();
  });

  it('a touch 404 (no longer openable here) shows NotFound', async () => {
    server.use(
      http.post('/api/remembered/:id/touch', () => HttpResponse.json(NOT_FOUND_BODY, { status: 404 })),
      http.get('/api/w/:id', () => HttpResponse.json(NOT_FOUND_BODY, { status: 404 })),
    );
    await renderApp({ pathname: `/w/${A_ID}` });
    expect(await screen.findByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
  });
});
