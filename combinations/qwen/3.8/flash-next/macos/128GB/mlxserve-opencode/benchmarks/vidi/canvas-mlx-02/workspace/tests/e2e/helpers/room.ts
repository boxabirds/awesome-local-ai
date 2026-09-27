// Multi-browser board helpers for story 3 collaboration e2e. Each "person" is a
// separate browser context (isolated storage/sockets) pointed at the SAME board
// id via the /b/:boardId route.
import type { Browser, Locator, Page } from '@playwright/test';

// Open (or join) a board by id. The Durable Object spins up on first connect.
export async function openBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-testid="viewport"]');
}

// The live connection state mirrored onto the test-only hook (test-mode build).
export async function getConnectionState(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () =>
      (window as unknown as { __vidi6?: { connectionState?: string } }).__vidi6?.connectionState,
  );
}

// The connection badge specifically. Scoped by [data-state] because the zoom
// indicator also uses role="status".
export function connectionBadge(page: Page): Locator {
  return page.locator('[role="status"][data-state]');
}

// A new context + page for one collaborator. Fixed viewport keeps world/screen
// math predictable.
export async function newCollaborator(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  return page;
}

// Force a genuine socket drop via the provider (drives y-websocket's real
// reconnect + resync path). context.setOffline() does NOT close an established
// WebSocket, so it cannot simulate a reconnect here.
export async function goOffline(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __vidi6?: { disconnect?(): void } }).__vidi6?.disconnect?.());
}

export async function goOnline(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __vidi6?: { connect?(): void } }).__vidi6?.connect?.());
}

// Open an existing note for editing by double-clicking its centre on screen.
export async function editNote(page: Page, screen: { x: number; y: number }): Promise<void> {
  await page.mouse.dblclick(screen.x, screen.y);
  await page.waitForSelector('textarea.sticky-editor');
}
