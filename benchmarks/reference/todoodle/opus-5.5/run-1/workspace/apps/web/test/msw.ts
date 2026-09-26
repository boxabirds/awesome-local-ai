import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { RememberedListResponse } from '@todoodle/shared/schemas';

/**
 * Defaults every test starts with (server.resetHandlers() restores them): this browser remembers
 * nothing, and open-by-id touch succeeds. Tests add or override handlers with `server.use(...)`.
 */
export const defaultHandlers = [
  http.get('/api/remembered', () => HttpResponse.json(RememberedListResponse.parse({ workspaces: [] }))),
  http.post('/api/remembered/:id/touch', () => new HttpResponse(null, { status: 204 })),
];

/** MSW server for component tests. */
export const server = setupServer(...defaultHandlers);
