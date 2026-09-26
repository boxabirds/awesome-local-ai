// Story 3 helpers: multi-context ("multi-user") e2e support.
//
// Each test builds its own Y.Doc-backed page through the REAL app: navigate
// to /b/<boardId> (the router honours valid ids), wait until the provider is
// synced (connectionState 'connected' = socket up AND first sync done).
// Latency measurements follow the PRD definition: sender DOM/doc change to
// visible change on every other screen, budget LIVE_UPDATE_LATENCY_BUDGET_MS.
// The test-only __vidi6 hook (App.tsx) is exposed only in test builds.

import { expect, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';

/** A fresh, VALID 22-char board id (same shape as newBoardId()). */
export function newRoomId(): string {
  return randomBytes(16)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .slice(0, 22);
}

/**
 * Open /b/<id> and wait until this client is CONNECTED: the test hook
 * exists, the socket is up and the first sync landed (state 'connected' or
 * 'confirmed'). An extra settle window lets in-flight sync updates apply.
 */
export async function openRoom(page: Page, id: string): Promise<void> {
  await page.goto(`/b/${id}`);
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __vidi6?: { getState(): { connectionState: string } };
      };
      const s = w.__vidi6?.getState()?.connectionState;
      return s === 'connected' || s === 'confirmed';
    },
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(600); // let the first sync apply fully
}

// ---- console hygiene ----

const collectors = new Map<Page, string[]>();

/** Start collecting console errors + uncaught exceptions on a page. */
export function errorCollector(page: Page): string[] {
  let errors = collectors.get(page);
  if (!errors) {
    const collected: string[] = [];
    collectors.set(page, collected);
    page.on('console', (msg) => {
      if (msg.type() === 'error') collected.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => collected.push(`pageerror: ${String(err)}`));
    errors = collected;
  }
  return errors;
}

// ---- board/document state ----

interface SnapshotItem {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
}

/** The page's FULL board document state (notes + text, sorted) as a string. */
export function docState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __vidi6?: { snapshot(): { id: string; x: number; y: number; color: string; text: string }[] };
    };
    const snap = [...(w.__vidi6?.snapshot() ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1));
    return JSON.stringify(snap);
  });
}

/** All pages' board states joined with '|' (for identical-snapshot checks). */
export async function allSnaps(pages: Page[]): Promise<string> {
  return (await Promise.all(pages.map((p) => docState(p)))).join('|');
}

/** Interaction state on a page (selection/editor) — for negative checks. */
export function boardState(page: Page): Promise<{ selectedId: string | null; editingId: string | null; connectionState: string }> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __vidi6?: { getState(): { selectedId: string | null; editingId: string | null; connectionState: string } };
    };
    return w.__vidi6!.getState();
  });
}

/**
 * Wait until every page's document state is IDENTICAL (the convergence
 * check). Returns the elapsed milliseconds; THROWS if the budget window
 * (timeoutMs) passes without convergence.
 */
export async function waitConverged(pages: Page[], timeoutMs = LIVE_UPDATE_LATENCY_BUDGET_MS): Promise<number> {
  const t0 = Date.now();
  await expect
    .poll(
      async () => {
        const snaps = await Promise.all(pages.map((p) => docState(p)));
        return new Set(snaps).size;
      },
      { timeout: timeoutMs, intervals: [50] },
    )
    .toBe(1);
  return Date.now() - t0;
}

/** Wait until a page's document contains exactly n notes. */
export async function waitNoteCount(page: Page, n: number, timeoutMs = 10_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const state = await docState(page);
        return (JSON.parse(state) as SnapshotItem[]).length;
      },
      { timeout: timeoutMs, intervals: [100] },
    )
    .toBe(n);
}

// ---- mutations (through the app's real wiring) ----

/** Seed a note centred on world point (x, y); returns its id. */
export function seedSticky(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate((a) => {
    const w = window as unknown as { __vidi6?: { seedSticky(x: number, y: number): string } };
    return w.__vidi6!.seedSticky(a.x - 100, a.y - 100); // centre → top-left
  }, { x, y });
}

/** Move a note's top-left to world (x, y). */
export function moveSticky(page: Page, id: string, x: number, y: number): Promise<void> {
  return page.evaluate((a) => {
    const w = window as unknown as { __vidi6?: { moveSticky(id: string, x: number, y: number): void } };
    w.__vidi6!.moveSticky(a.id, a.x, a.y);
  }, { id, x, y });
}

/** Set a note's colour (same doc mutation as the toolbar). */
export function colorSticky(page: Page, id: string, color: string): Promise<void> {
  return page.evaluate((a) => {
    const w = window as unknown as { __vidi6?: { colorSticky(id: string, color: string): void } };
    w.__vidi6!.colorSticky(a.id, a.color);
  }, { id, color });
}

/** Point near a note's top-left corner (viewport coords). The note centre
 * can end up under the bottom-right zoom bar when a note is dragged to the
 * corner of the viewport, so interaction helpers aim at the corner. */
export async function notePoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(`[data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`notePoint: note ${id} not rendered`);
  return { x: box.x + 10, y: box.y + 10 };
}

/**
 * Type text into a note the REAL way: double-click to open the editor and
 * fill the textarea (React onChange → Y.Text), then Escape to close it.
 */
export async function typeSticky(page: Page, id: string, text: string): Promise<void> {
  // Close any still-open editor so the double-click opens a fresh one.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(30);
  const p = await notePoint(page, id);
  await page.mouse.dblclick(p.x, p.y);
  const editor = page.getByTestId('sticky-textarea');
  await editor.waitFor({ state: 'visible', timeout: 3000 });
  await editor.fill(text);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(30);
}

/**
 * Append characters to a note's Y.Text directly (the document change the
 * editor produces). Used by the capacity soak, where 25+ notes pile up and
 * the editor's hit-test target is no longer unique — propagation, not UI
 * plumbing, is what the soak measures.
 */
export function typeStickyViaDoc(page: Page, id: string, text: string): Promise<boolean> {
  return page.evaluate((a) => {
    const w = window as unknown as {
      __vidi6?: { typeSticky(id: string, text: string, at?: number): boolean };
    };
    return w.__vidi6!.typeSticky(a.id, a.text);
  }, { id, text });
}

/** Delete a note (same doc mutation as the toolbar's delete button). */
export function deleteSticky(page: Page, id: string): Promise<void> {
  return page.evaluate((a) => {
    const w = window as unknown as { __vidi6?: { deleteSticky(id: string): void } };
    w.__vidi6!.deleteSticky(a.id);
  }, { id });
}