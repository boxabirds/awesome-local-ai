import { setupServer } from 'msw/node';

/** Shared MSW server; later stories register API handlers per test with `server.use(...)`. */
export const server = setupServer();
