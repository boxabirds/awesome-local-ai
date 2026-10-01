import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { newBoardId } from '../../src/shared/board-id';

// Component tests never open real sockets: the provider is a no-op stub.
vi.mock('y-websocket', () => ({
  WebsocketProvider: class {
    on() {}
    destroy() {}
  },
}));

// `App` serves a board at /b/:boardId; `/` would redirect.
beforeEach(() => window.history.replaceState({}, '', `/b/${newBoardId()}`));
afterEach(() => cleanup());
