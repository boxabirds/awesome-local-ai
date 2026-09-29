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

// Story 5: BoardPage asks the server whether the board exists before
// mounting; by default the board exists and creation succeeds. Individual
// tests (pages.test.tsx) override the mocks with vi.mocked(...).mockReset()
// and their own implementations.
vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(async () => ({ status: 'created', id: 'mockboardid1234567890a' })),
  checkBoard: vi.fn(async () => ({ status: 'exists' as const })),
}));
