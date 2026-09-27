import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '@/App';
import { NotFound } from '@/routes/NotFound';
import { handlers, NOT_FOUND_BODY, SECRET } from '../fixtures';
import { server } from '../msw';
import { renderApp } from '../render';

const TIP = "Links are long — check it wasn't cut off when it was copied.";

function renderNotFound(recovery?: React.ReactNode) {
  return render(
    <AppProviders>
      <MemoryRouter>
        <NotFound recovery={recovery} />
      </MemoryRouter>
    </AppProviders>,
  );
}

describe('workspace not found', () => {
  it('TC-52 open 404 -> Workspace not found + Start a new list; no workspace data', async () => {
    server.use(handlers.openNotFound());
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    expect(await screen.findByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
    expect(screen.getByText(TIP)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a new list' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Share/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Workspace name')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(NOT_FOUND_BODY.message.toLowerCase() + '.');
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('TC-52 a 400 (malformed) renders the same page', async () => {
    server.use(http.post('/api/workspaces/open', () => HttpResponse.json({ error: 'validation', message: 'x' }, { status: 400 })));
    await renderApp({ pathname: '/w', hash: '#short' });
    expect(await screen.findByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
  });

  it.each(['', '#'])('TC-53 /w with hash %j -> NotFound without calling open', async (hash) => {
    let opens = 0;
    server.use(
      http.post('/api/workspaces/open', () => {
        opens++;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    await renderApp({ pathname: '/w', hash });
    expect(await screen.findByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(opens).toBe(0);
  });

  it('is the catch-all for unknown paths', async () => {
    await renderApp({ pathname: '/nope/deep' });
    expect(screen.getByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
  });

  it('TC-82 without recovery nothing renders between the tip and the button', () => {
    renderNotFound();
    const tip = screen.getByText(TIP);
    const next = tip.nextElementSibling;
    expect(next).toContainElement(screen.getByRole('button', { name: 'Start a new list' }));
  });

  it('TC-82 with recovery the node renders between the tip and the button', () => {
    renderNotFound(<span>x</span>);
    const tip = screen.getByText(TIP);
    expect(tip.nextElementSibling).toBe(screen.getByText('x'));
    expect(screen.getByText('x').nextElementSibling).toContainElement(
      screen.getByRole('button', { name: 'Start a new list' }),
    );
  });
});
