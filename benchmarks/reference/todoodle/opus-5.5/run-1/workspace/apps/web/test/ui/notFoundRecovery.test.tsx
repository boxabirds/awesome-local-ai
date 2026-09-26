import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../msw.ts';
import { gate } from '../support/fixtures.ts';
import { A, B, expectNoAxeViolations, rememberedHandler, workspaceFor, workspacesHandler } from '../support/remembered.ts';
import { currentLocation, renderApp } from '../support/render.tsx';

const HEADING = 'Your workspaces on this browser';
const TIP = 'Links are long — check it wasn\'t cut off when it was copied.';

function expectNotFoundText() {
  expect(screen.getByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
  expect(screen.getByText(TIP)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start a new list' })).toBeEnabled();
}

describe('notfound.remembered (TC-69)', () => {
  it('2 entries -> the list with its heading above Start a new list; rows open the workspace', async () => {
    server.use(rememberedHandler([A, B]), workspacesHandler([workspaceFor(A)]));
    const { user } = await renderApp('/nope');
    const heading = await screen.findByRole('heading', { name: HEADING });
    expectNotFoundText();
    const start = screen.getByRole('button', { name: 'Start a new list' });
    expect(heading.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const region = screen.getByRole('region', { name: HEADING });
    expect(within(region).getAllByRole('link')).toHaveLength(2);
    await expectNoAxeViolations();
    await user.click(within(region).getByRole('link', { name: new RegExp(`^${A.name}`) }));
    await waitFor(() => expect(currentLocation.value?.pathname).toBe(`/w/${A.id}`));
  });

  it('0 entries -> nothing rendered in the slot (no heading, no hint)', async () => {
    let requested = false;
    server.use(rememberedHandler([], { onRequest: () => (requested = true) }));
    await renderApp('/nope');
    await waitFor(() => expect(requested).toBe(true));
    await waitFor(() => expect(screen.queryByLabelText('Loading your workspaces')).toBeNull());
    expect(screen.queryByRole('heading', { name: HEADING })).toBeNull();
    expect(screen.queryByText('Have a link? Open it to get back in.')).toBeNull();
    expectNotFoundText();
  });

  it('loading -> skeleton rows', async () => {
    const hold = gate();
    server.use(rememberedHandler([A], { until: hold.promise }));
    await renderApp('/nope');
    expect(screen.getByLabelText('Loading your workspaces')).toBeInTheDocument();
    expectNotFoundText();
    await act(async () => hold.release());
    expect(await screen.findByRole('heading', { name: HEADING })).toBeInTheDocument();
  });

  it('error -> nothing rendered in the slot', async () => {
    let requested = false;
    server.use(rememberedHandler([], { status: 500, onRequest: () => (requested = true) }));
    await renderApp('/w');
    await screen.findByRole('heading', { name: 'Workspace not found' });
    await waitFor(() => expect(requested).toBe(true));
    await waitFor(() => expect(screen.queryByLabelText('Loading your workspaces')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText("Couldn't load your workspaces")).toBeNull();
    expectNotFoundText();
  });
});
