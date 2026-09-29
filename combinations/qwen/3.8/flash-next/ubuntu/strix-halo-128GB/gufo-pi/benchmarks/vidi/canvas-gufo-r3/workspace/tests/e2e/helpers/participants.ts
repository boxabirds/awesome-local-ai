import { Browser, BrowserContext, Page, expect } from '@playwright/test';

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 !== undefined) out += B64URL[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 !== undefined) out += B64URL[b2 & 63];
  }
  return out;
}

export interface Participant {
  name: string;
  ctx: BrowserContext;
  page: Page;
}

/**
 * Generate a board id matching @shared/board-id (16 random bytes → base64url, no
 * padding). Implemented here in Node so Playwright specs need no source aliases.
 */
export function newE2eBoardId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** Wait until the client has mapped its connection state to a synced state. */
async function waitConnected(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __vidi6?: { connectionState?: string } }).__vidi6?.connectionState;
      return s === 'connected' || s === 'confirmed';
    },
    undefined,
    { timeout: 15000 },
  );
}

/**
 * Open `n` isolated browser contexts on the same /b/<boardId>. Each context has its
 * own provider and its own connection — the only way they can sync is through the
 * server (BroadcastChannel is disabled in the client).
 */
export async function openParticipants(
  browser: Browser,
  boardId: string,
  n: number,
): Promise<Participant[]> {
  const participants: Participant[] = [];
  for (let i = 0; i < n; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`/b/${boardId}`);
    await waitConnected(page);
    participants.push({ name: `p${i}`, ctx, page });
  }
  return participants;
}

export async function closeParticipants(participants: Participant[]): Promise<void> {
  for (const p of participants) {
    await p.ctx.close();
  }
}

/**
 * expect.poll wrapper that asserts a condition within the live-update latency
 * budget. Usage: `await expectWithin(BUDGET)(async () => count(page)).toBe(1)`.
 */
export function expectWithin(ms: number) {
  return <T>(fn: () => Promise<T> | T) => expect.poll(fn, { timeout: ms, intervals: [25, 50, 100] });
}

/** Background colour of a note, for recolour propagation checks. */
export async function getNoteColor(page: Page, id: string): Promise<string> {
  return page
    .locator(`[data-testid="sticky-note"][data-note-id="${id}"]`)
    .evaluate((el) => getComputedStyle(el).backgroundColor);
}
