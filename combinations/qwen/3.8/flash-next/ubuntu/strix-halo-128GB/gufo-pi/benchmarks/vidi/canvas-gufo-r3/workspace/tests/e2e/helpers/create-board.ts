import { Page } from '@playwright/test';

const serverUrl = 'http://localhost:8787';

/**
 * Create a board via the test hook (bypasses rate limiting) and navigate to it.
 * Waits for WebSocket connection. Returns the board ID.
 */
export async function createAndGotoBoard(page: Page): Promise<string> {
  const res = await fetch(`${serverUrl}/api/test/_create/init`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to create board: ${res.status}`);
  const { id } = await res.json() as { id: string };
  await page.goto(`/b/${id}`);
  // Wait for the WebSocket to connect
  await page.waitForFunction(
    () => {
      const s = (window as any).__vidi6?.connectionState;
      return s === 'connected' || s === 'confirmed';
    },
    undefined,
    { timeout: 15000 },
  );
  return id;
}
