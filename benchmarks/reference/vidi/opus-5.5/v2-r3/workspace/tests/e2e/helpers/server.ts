// The shared e2e server (playwright.config.ts webServer).
export const E2E_PORT = 8787;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

/** Creates a board through the real API (story 5: only created boards open). */
export async function createBoardId(baseURL: string = E2E_BASE_URL): Promise<string> {
  const res = await fetch(`${baseURL}/api/boards`, { method: 'POST' });
  if (res.status !== 201) throw new Error(`create board: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}
