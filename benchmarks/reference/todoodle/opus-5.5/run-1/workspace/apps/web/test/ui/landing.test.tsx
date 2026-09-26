import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { server } from '../msw.ts';
import { SECRET, WORKSPACE, createHandler, gate } from '../support/fixtures.ts';
import { currentLocation, renderApp } from '../support/render.tsx';

describe('web.landing', () => {
  it('shows the product name, the pitch and the Start button', async () => {
    await renderApp('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Todoodle' })).toBeInTheDocument();
    expect(screen.getByText(/No sign-up, just a link/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a new list' })).toBeEnabled();
  });

  it('TC-41 Start calls create once and is disabled while pending (double click = 1 call)', async () => {
    const hold = gate();
    let calls = 0;
    server.use(createHandler({ onRequest: () => calls++, until: hold.promise }));
    const { user } = await renderApp('/');
    const button = screen.getByRole('button', { name: 'Start a new list' });
    await user.dblClick(button);
    expect(button).toBeDisabled();
    hold.release();
    await waitFor(() => expect(currentLocation.value?.pathname).toBe('/w'));
    expect(calls).toBe(1);
    // Primed from the create response in onSuccess: no second fetch needed for the name.
    expect(queryClient.getQueryData(queryKeys.workspace(WORKSPACE.id))).toEqual(WORKSPACE);
    expect(currentLocation.value?.hash).toBe(`#${SECRET}`);
    expect(currentLocation.value?.state).toEqual({ justCreated: true });
  });

  it("TC-42 create 500 -> 'Couldn't create your list — try again', button enabled, no navigation", async () => {
    server.use(createHandler({ status: 500 }));
    const { user } = await renderApp('/');
    await user.click(screen.getByRole('button', { name: 'Start a new list' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't create your list — try again");
    expect(screen.getByRole('button', { name: 'Start a new list' })).toBeEnabled();
    expect(currentLocation.value?.pathname).toBe('/');
    expect(currentLocation.value?.hash).toBe('');
  });
});
