import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { RememberedListResponse } from '@todoodle/shared/schemas';
import { defaultProjectHandlers } from './msw/projects.ts';
import { defaultTaskHandlers } from './msw/tasks.ts';
import { defaultTodayHandlers } from './msw/today.ts';

/**
 * Defaults every test starts with (server.resetHandlers() restores them): this browser remembers
 * nothing, open-by-id touch succeeds, and the Inbox is empty. Tests add or override handlers with `server.use(...)`.
 */
export const defaultHandlers = [
  http.get('/api/remembered', () => HttpResponse.json(RememberedListResponse.parse({ workspaces: [] }))),
  http.post('/api/remembered/:id/touch', () => new HttpResponse(null, { status: 204 })),
  // Story 5: every workspace view loads its Inbox and counts; by default the Inbox is empty.
  ...defaultTaskHandlers,
  // Story 7: every workspace view loads its projects (the sidebar); by default there are none.
  ...defaultProjectHandlers,
  // Story 8: the sidebar's Today entry prefetches Today on hover and focus; by default nothing is due.
  ...defaultTodayHandlers,
];

/** MSW server for component tests. */
export const server = setupServer(...defaultHandlers);
