import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { SECRET, WS_ID, workspace } from '../fixtures';
import { server } from '../msw';
import { currentLocation, deferred, renderApp } from '../render';

describe('landing page', () => {
  it('renders the product name, pitch and Start button', async () => {
    await renderApp({ pathname: '/' });
    expect(screen.getByRole('heading', { level: 1, name: 'Todoodle' })).toBeInTheDocument();
    expect(screen.getByText(/No sign-up needed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a new list' })).toBeEnabled();
  });

  it('TC-41 Start calls create once and is disabled while pending (double click = 1 call)', async () => {
    let calls = 0;
    const gate = deferred();
    server.use(
      http.post('/api/workspaces', async () => {
        calls++;
        await gate.promise;
        return HttpResponse.json({ workspace: workspace(), secret: SECRET, dropped: 0 }, { status: 201 });
      }),
    );
    await renderApp({ pathname: '/' });
    const button = screen.getByRole('button', { name: 'Start a new list' });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(calls).toBe(1));
    await act(async () => gate.resolve());
    await screen.findByRole('dialog', { name: 'Save your link' });
    expect(calls).toBe(1);
    // Primed from the create response (no second fetch) and navigated with justCreated.
    expect(queryClient.getQueryData(queryKeys.workspace(WS_ID))).toEqual(workspace());
    expect(currentLocation.value?.pathname).toBe('/w');
  });

  it("TC-42 create 500 -> 'Couldn't create your list — try again', button enabled, no navigation", async () => {
    server.use(http.post('/api/workspaces', () => HttpResponse.json({ error: 'internal', message: 'x' }, { status: 500 })));
    await renderApp({ pathname: '/' });
    fireEvent.click(screen.getByRole('button', { name: 'Start a new list' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't create your list — try again");
    expect(screen.getByRole('button', { name: 'Start a new list' })).toBeEnabled();
    expect(currentLocation.value?.pathname).toBe('/');
    expect(screen.queryByText('My Todoodle')).not.toBeInTheDocument();
  });

  it('TC-42 a network failure shows the same message', async () => {
    server.use(http.post('/api/workspaces', () => HttpResponse.error()));
    await renderApp({ pathname: '/' });
    fireEvent.click(screen.getByRole('button', { name: 'Start a new list' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't create your list — try again");
    expect(currentLocation.value?.pathname).toBe('/');
  });
});
