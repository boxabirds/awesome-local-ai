import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { server } from '../msw.ts';
import { gate } from '../support/fixtures.ts';
import { A, cacheRemembered, workspaceFor, workspacesHandler } from '../support/remembered.ts';
import { renderApp } from '../support/render.tsx';

const nameInput = () => screen.queryByRole('textbox', { name: 'Workspace name' });

describe('workspace.instant_name (TC-70)', () => {
  it('list cached: the header shows the name before GET resolves; real data then replaces it', async () => {
    cacheRemembered([A]);
    const hold = gate();
    server.use(workspacesHandler([workspaceFor(A, 'Groceries (renamed)')], { until: hold.promise }));
    await renderApp(`/w/${A.id}`);
    // The route chunk may still be loading; the name must appear while GET is still held.
    await waitFor(() => expect(nameInput()).toHaveValue(A.name));
    expect(screen.getByLabelText('Loading tasks')).toHaveAttribute('aria-busy', 'true');
    // The placeholder is never written into the cache.
    expect(queryClient.getQueryData(queryKeys.workspace(A.id))).toBeUndefined();
    expect(queryClient.getQueryState(queryKeys.workspace(A.id))?.status).toBe('pending');

    await act(async () => hold.release());
    await waitFor(() => expect(nameInput()).toHaveValue('Groceries (renamed)'));
    expect(screen.queryByLabelText('Loading tasks')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
  });

  it('GET 404 after the placeholder -> NotFound, and the name is gone from the header', async () => {
    cacheRemembered([A]);
    const hold = gate();
    server.use(
      http.get('/api/w/:id', async () => {
        await hold.promise;
        return HttpResponse.json({ error: 'not_found', message: 'Workspace not found' }, { status: 404 });
      }),
    );
    await renderApp(`/w/${A.id}`);
    // The route chunk may still be loading; the name must appear while GET is still held.
    await waitFor(() => expect(nameInput()).toHaveValue(A.name));
    await act(async () => hold.release());
    expect(await screen.findByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
    expect(nameInput()).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
  });

  it('network error after the placeholder -> "Couldn\'t load this workspace" with Try again', async () => {
    cacheRemembered([A]);
    server.use(http.get('/api/w/:id', () => HttpResponse.error()));
    await renderApp(`/w/${A.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this workspace.");
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(nameInput()).toBeNull();
  });

  it('empty cache (cold load) -> header skeleton only, no name', async () => {
    const hold = gate();
    server.use(workspacesHandler([workspaceFor(A)], { until: hold.promise }));
    await renderApp(`/w/${A.id}`);
    expect(screen.getByLabelText('Loading workspace')).toHaveAttribute('aria-busy', 'true');
    expect(nameInput()).toBeNull();
    await act(async () => hold.release());
    await waitFor(() => expect(nameInput()).toHaveValue(A.name));
  });
});
