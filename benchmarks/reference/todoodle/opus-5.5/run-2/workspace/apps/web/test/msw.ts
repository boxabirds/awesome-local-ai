import { RememberedListResponse } from '@todoodle/shared/schemas';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/**
 * Handlers every test starts with (server.resetHandlers() returns to these): this browser
 * remembers nothing, and opening by id is accepted. Tests override them with `server.use(...)`.
 */
export const defaultHandlers = [
  http.get('/api/remembered', () => HttpResponse.json(RememberedListResponse.parse({ workspaces: [] }))),
  http.post('/api/remembered/:id/touch', () => new HttpResponse(null, { status: 204 })),
];

/** Shared MSW server; tests register API handlers per test with `server.use(...)`. */
export const server = setupServer(...defaultHandlers);
