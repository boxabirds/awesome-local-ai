// Shared render helper (story 5): the app is now a router, and the board
// page verifies the board exists via GET /api/boards/:id before mounting
// the board. Component tests render at a board URL with a globally mocked
// fetch (tests/component/setup.ts answers 200), so the board mounts
// immediately.

import { act, render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../src/client/App';
import { newBoardId } from '../../src/shared/board-id';

/** A fresh, well-formed /b/<id> path for rendering the board page. */
export function boardPath(): string {
  return `/b/${newBoardId()}`;
}

/**
 * Renders the routed app at `path` (default: a fresh board) and waits for
 * the board page's existence check to pass, so the board is mounted when
 * the test starts (the check is a fetch, i.e. at least one microtask).
 */
export async function renderAppAt(path: string = boardPath()): Promise<RenderResult> {
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await act(async () => {
    // Flush microtasks (fetch + json) and let React commit the mount.
  });
  return result;
}
