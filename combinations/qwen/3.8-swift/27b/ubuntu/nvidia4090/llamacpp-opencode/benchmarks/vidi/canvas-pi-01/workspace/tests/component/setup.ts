// Component-test environment setup (jsdom).
//
// The real `connectBoard` attaches a y-websocket WebsocketProvider, which
// opens a browser WebSocket on mount. jsdom implements WebSocket via the `ws`
// package, which refuses to run in a browser context — so the component
// environment mocks `connectBoard` (no network) while keeping the pure
// connection state machine real (the badge tests drive it directly).

import { vi } from 'vitest';

vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  return {
    ...actual,
    connectBoard: vi.fn(() => ({ destroy: vi.fn() })),
  };
});
