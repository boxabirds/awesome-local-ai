import { expect } from "@playwright/test";

/**
 * Story 5 e2e helper: the board API from the test runner, not from a browser.
 *
 * Two reasons a test needs this rather than `page.request`:
 *
 *   - a board has to exist **before** a page opens its link, and tests that are
 *     about "what an unknown link does" must be able to name a link that was
 *     never created;
 *   - the persistence tests talk to a server they started themselves, so they
 *     pass that server's port explicitly.
 *
 * `TEST_HOOKS` (`src/worker/test-hooks.ts`) is enabled on every e2e server
 * (`npm run serve:e2e`, `startWrangler`) because seeding a *legacy* board —
 * content with no `created_at` — is something the product can no longer do for
 * a test.
 */

/** Port of the shared e2e server (`playwright.config.ts`). */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 27840);

function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** `POST /api/boards` — creates a board the way the product does. */
export async function createBoard(port: number = E2E_PORT): Promise<string> {
  const response = await fetch(`${baseUrl(port)}/api/boards`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`POST /api/boards on port ${port} answered ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== "string" || body.id.length !== 22) {
    throw new Error(`POST /api/boards returned no usable id: ${JSON.stringify(body)}`);
  }
  return body.id;
}

/** Creates several boards at once (link-sharing tests need more than one). */
export async function createBoards(count: number, port: number = E2E_PORT): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) ids.push(await createBoard(port));
  return ids;
}

/** `GET /api/boards/:id` — what the server says about a link. */
export async function boardStatus(boardId: string, port: number = E2E_PORT): Promise<number> {
  const response = await fetch(`${baseUrl(port)}/api/boards/${encodeURIComponent(boardId)}`);
  return response.status;
}

/** Asserts a board exists, with the reason spelled out when it does not. */
export async function expectBoardExists(boardId: string, port: number = E2E_PORT): Promise<void> {
  expect(await boardStatus(boardId, port), `board ${boardId} should exist on port ${port}`).toBe(200);
}

/**
 * Seeds a **legacy** board: saved content and no `created_at`, the shape a board
 * had before story 5 existed. Only possible through the test-only hook, which is
 * exactly why the hook exists (TC-31).
 */
export async function seedLegacyBoard(
  boardId: string,
  updates: readonly Uint8Array[],
  port: number = E2E_PORT,
): Promise<void> {
  const response = await fetch(`${baseUrl(port)}/__test-hooks/legacy-board`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: boardId, updates: updates.map(toBase64) }),
  });
  if (!response.ok) {
    throw new Error(`seeding legacy board ${boardId} answered ${response.status}: ${await response.text()}`);
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return Buffer.from(binary, "binary").toString("base64");
}
