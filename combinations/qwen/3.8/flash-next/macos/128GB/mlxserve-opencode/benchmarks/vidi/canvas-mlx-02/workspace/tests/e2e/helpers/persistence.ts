// End-to-end helpers for story 4: the room's failure-injection hooks (mapped
// onto the Durable Object only when it runs with TEST_HOOKS=1, which the e2e
// wrangler dev does and production never does), plus a reader for what the page
// actually shows.
import type { Page } from '@playwright/test';

export interface RoomStats {
  lifecycle: string;
  state: string;
  loadError: string | null;
  serving: boolean;
  updateCount: number;
  updateBytes: number;
  logRows: number;
  logBytes: number;
  chunks: number;
  chunkSizes: number[];
  throughSeq: number;
  quarantined: number;
  sockets: number;
  compacting: boolean;
}

// The `wrangler dev` that playwright.config.ts starts.
export const SHARED_ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:4173';

// Plain Node-side HTTP, deliberately not the test's request fixture: that one is
// tied to the browser context, and these calls are to the server, whose answer
// must be readable even in the test's last seconds.
async function call(
  origin: string,
  boardId: string,
  action: string,
  init?: { method?: string; data?: Uint8Array },
): Promise<RoomStats> {
  const res = await fetch(`${origin}/__test/boards/${boardId}/${action}`, {
    method: init?.method ?? 'GET',
    // Cast: the DOM lib's BodyInit does not admit Uint8Array<ArrayBufferLike>.
    body: (init?.data as unknown as BodyInit) ?? undefined,
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`test hook ${action} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return JSON.parse(body) as RoomStats;
}

export const roomStats = (boardId: string, origin = SHARED_ORIGIN) =>
  call(origin, boardId, 'state');

/** The room throws its in-memory document away and reads the board again. */
export const forgetRoom = (boardId: string, origin = SHARED_ORIGIN) =>
  call(origin, boardId, 'reload', { method: 'POST' });

/** Force a compaction now, instead of waiting for the threshold. */
export const compactRoom = (boardId: string, origin = SHARED_ORIGIN) =>
  call(origin, boardId, 'compact', { method: 'POST' });

/** Replace the snapshot the board reads back with bytes that fail to apply. */
export const corruptRoom = (boardId: string, origin = SHARED_ORIGIN) =>
  call(origin, boardId, 'corrupt-snapshot', { method: 'POST' });

/** Put the snapshot bytes back, as an operator who fixed storage would. */
export const repairRoom = (boardId: string, origin = SHARED_ORIGIN) =>
  call(origin, boardId, 'repair-snapshot', { method: 'POST' });

/** Hand the room one Yjs update to apply, append and fold. */
export const seedRoom = (boardId: string, update: Uint8Array, origin = SHARED_ORIGIN) =>
  call(origin, boardId, 'seed', { method: 'POST', data: update });

export async function waitForRoom(
  boardId: string,
  predicate: (s: RoomStats) => boolean,
  what: string,
  origin = SHARED_ORIGIN,
  timeoutMs = 30000,
): Promise<RoomStats> {
  const start = Date.now();
  for (;;) {
    const s = await roomStats(boardId, origin);
    if (predicate(s)) return s;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for ${what}: ${JSON.stringify(s)}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ---------------------------------------------------------------------------
// What the page shows
// ---------------------------------------------------------------------------

export interface NoteOnScreen {
  id: string;
  x: number;
  y: number;
  text: string;
  editable: boolean;
}

/** Every note the page renders, with its world position, text and editability. */
export async function readNotes(page: Page): Promise<NoteOnScreen[]> {
  return page.$$eval('[role="group"][aria-label="Sticky note"]', (els) =>
    els.map((raw) => {
      const el = raw as HTMLElement;
      return {
        id: el.getAttribute('data-testid') ?? '',
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        text: el.querySelector('.sticky-text')?.textContent ?? '',
        editable: el.getAttribute('data-editable') === 'true',
      };
    }),
  );
}

/** Compare two readings of a board, with a reason that is useful in a failure. */
export function compareNotes(
  before: readonly NoteOnScreen[],
  after: readonly NoteOnScreen[],
): string {
  if (before.length !== after.length) {
    return `note count: ${before.length} before, ${after.length} after`;
  }
  const idsBefore = [...before].map((n) => n.id).sort();
  const idsAfter = [...after].map((n) => n.id).sort();
  for (let i = 0; i < idsBefore.length; i++) {
    if (idsBefore[i] !== idsAfter[i]) return `note ids differ at ${i}`;
  }
  for (const b of before) {
    const a = after.find((n) => n.id === b.id);
    if (!a) return `note ${b.id} is gone`;
    if (a.text !== b.text) return `note ${b.id} text: ${JSON.stringify(b.text)} -> ${JSON.stringify(a.text)}`;
    if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1) {
      return `note ${b.id} moved: ${b.x},${b.y} -> ${a.x},${a.y}`;
    }
  }
  return '';
}

/** Wait until the page's notes match `before` (a returning client's assertion). */
export async function notesRestored(page: Page, before: readonly NoteOnScreen[], timeoutMs = 20000): Promise<string> {
  const start = Date.now();
  let why = 'no notes at all';
  for (;;) {
    const after = await readNotes(page);
    why = compareNotes(before, after);
    if (!why) return '';
    if (Date.now() - start > timeoutMs) return why;
    await page.waitForTimeout(150);
  }
}

/**
 * Wait for the badge to stop saying the board cannot be loaded, and if it does
 * not, report what the room itself says. The room's own state is what tells a
 * failure apart: a room that is `ready` with the badge still red is a client that
 * stopped retrying; a room still `load-failed` is a repair that did not take.
 */
export async function expectRecovered(
  page: Page,
  boardId: string,
  timeoutMs: number,
  origin = SHARED_ORIGIN,
): Promise<void> {
  const badge = page.locator('[role="status"][data-state]');
  const start = Date.now();
  for (;;) {
    const shown = await badge.getAttribute('data-state').catch(() => 'gone');
    if (shown === 'gone' || shown === 'connected' || shown === 'confirmed') return;
    if (Date.now() - start > timeoutMs) {
      const room = await roomStats(boardId, origin).catch((e) => ({ error: String(e) }));
      throw new Error(
        `the board did not come back after ${timeoutMs}ms: badge=${shown} room=${JSON.stringify(room)}`,
      );
    }
    await page.waitForTimeout(300);
  }
}
