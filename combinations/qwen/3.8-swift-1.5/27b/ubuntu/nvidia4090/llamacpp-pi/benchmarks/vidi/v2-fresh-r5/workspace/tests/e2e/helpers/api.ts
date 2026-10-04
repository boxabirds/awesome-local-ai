/**
 * Shared e2e API helpers (story 5). Boards are created server-side: every
 * fixture that needs a board calls `createBoard()` first (the room no
 * longer creates storage implicitly on connect).
 */

/** The shared e2e webServer (playwright.config.ts) port. */
export const E2E_BASE_URL = 'http://127.0.0.1:20608';

/**
 * Create a board via the real API (POST /api/boards) and return its id.
 * @param baseUrl the server to create on (defaults to the shared e2e server).
 */
export async function createBoard(baseUrl: string = E2E_BASE_URL): Promise<string> {
  const res = await fetch(`${baseUrl}/api/boards`, { method: 'POST' });
  if (res.status !== 201) {
    throw new Error(`POST /api/boards → ${res.status} (expected 201)`);
  }
  const body = (await res.json()) as { id: string };
  return body.id;
}
