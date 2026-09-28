// Board creation for e2e tests (story 5: boards must be created before they can be opened).
import { expect, type APIRequestContext } from '@playwright/test';

/** Port of the shared `wrangler dev` e2e server (playwright.config.ts). */
export const E2E_PORT = 8788;

/**
 * A made-up visitor address. Board creation is rate limited per CF-Connecting-IP (which local `wrangler dev`
 * keeps when the request already carries it), so each test gets its own bucket and parallel tests never
 * exhaust each other's limit.
 */
export function randomVisitorIp(): string {
  const b = () => Math.floor(Math.random() * 254) + 1;
  return `10.${b()}.${b()}.${b()}`;
}

/** Creates a board through POST /api/boards on the server at `baseURL`; returns its id. */
export async function createBoardAt(baseURL: string = `http://127.0.0.1:${E2E_PORT}`): Promise<string> {
  const res = await fetch(`${baseURL}/api/boards`, { method: 'POST', headers: { 'CF-Connecting-IP': randomVisitorIp() } });
  expect(res.status, 'POST /api/boards').toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Same, through a Playwright request context (uses its baseURL). */
export async function createBoard(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/boards', { headers: { 'CF-Connecting-IP': randomVisitorIp() } });
  expect(res.status(), 'POST /api/boards').toBe(201);
  return ((await res.json()) as { id: string }).id;
}
