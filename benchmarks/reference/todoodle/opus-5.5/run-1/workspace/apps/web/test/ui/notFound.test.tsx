import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { NotFound } from '@/routes/NotFound';
import { server } from '../msw.ts';
import { SECRET, createHandler, recordRequests } from '../support/fixtures.ts';
import { Providers, currentLocation, renderApp } from '../support/render.tsx';

const TIP = "Links are long — check it wasn't cut off when it was copied.";

describe('web.not_found', () => {
  it("TC-52 open 404 -> 'Workspace not found' + Start a new list; no workspace data rendered", async () => {
    server.use(http.post('/api/workspaces/open', () => HttpResponse.json({ error: 'not_found', message: 'Workspace not found' }, { status: 404 })));
    await renderApp(`/w#${SECRET}`);
    expect(await screen.findByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a new list' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Workspace name' })).toBeNull();
    expect(screen.queryByText('Inbox')).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('TC-53 /w with an empty hash renders NotFound and never calls open', async () => {
    const seen = recordRequests();
    await renderApp('/w');
    expect(await screen.findByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
    await renderApp('/w#');
    expect(seen).toEqual([]);
  });

  it('unknown paths render NotFound (router catch-all)', async () => {
    await renderApp('/nope/at/all');
    expect(screen.getByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
  });

  it('TC-82 shows the cut-off tip; the recovery slot is empty without the prop and renders the node with it', () => {
    const { container, unmount } = render(
      <Providers entry="/w">
        <NotFound />
      </Providers>,
    );
    const tip = screen.getByText(TIP);
    const button = screen.getByRole('button', { name: 'Start a new list' });
    expect(tip.nextElementSibling).toBe(button.parentElement);
    expect(container.textContent).not.toContain('x!');
    unmount();

    render(
      <Providers entry="/w">
        <NotFound recovery={<span>x!</span>} />
      </Providers>,
    );
    const slot = screen.getByText('x!');
    expect(screen.getByText(TIP).nextElementSibling).toBe(slot);
    expect(slot.nextElementSibling).toBe(screen.getByRole('button', { name: 'Start a new list' }).parentElement);
  });

  it('Start a new list on NotFound creates a workspace and goes there', async () => {
    server.use(createHandler());
    const { user } = await renderApp('/w');
    await user.click(screen.getByRole('button', { name: 'Start a new list' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(currentLocation.value?.hash).toBe(`#${SECRET}`);
  });
});
