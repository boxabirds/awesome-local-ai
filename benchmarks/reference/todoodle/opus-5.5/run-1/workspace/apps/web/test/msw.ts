import { setupServer } from 'msw/node';

/** MSW server for component tests. Tests add handlers with `server.use(...)`. */
export const server = setupServer();
