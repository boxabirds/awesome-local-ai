import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import { newBoardId } from '@shared/board-id';
import { PERSIST_TESTED_NOTES, BOARD_LOAD_BUDGET_MS } from '@shared/config';
import { getNoteCount } from './helpers/board';
import { waitForConnected, createBoardViaUi } from './helpers/participants';
import { startWrangler, cleanupDir, type WranglerProc } from './helpers/wrangler-process';

// Serialize within this file: each test manages its own wrangler dev on a fixed
// port, so we avoid racing two servers on the same port.
test.describe.configure({ mode: 'serial' });

async function waitUntil(
  fn: () => Promise<number>,
  target: (n: number) => boolean,
  timeoutMs = 20_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (target(await fn())) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`waitUntil not met after ${timeoutMs}ms (last=${await fn()})`);
}

async function snap(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const notes = document.querySelectorAll('[role="group"][aria-label="Sticky note"]');
    const result: Array<{ x: number; y: number; text: string; bg: string }> = [];
    notes.forEach((n) => {
      const el = n as HTMLElement;
      const textEl = el.querySelector('.sticky-note-text') || el.querySelector('.sticky-textarea');
      const text = textEl && 'value' in textEl ? (textEl as HTMLTextAreaElement).value : textEl?.textContent ?? '';
      result.push({
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        text,
        bg: el.style.backgroundColor,
      });
    });
    result.sort((a, b) => a.x - b.x || a.y - b.y);
    return JSON.stringify(result);
  });
}

async function addNote(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
  text: string,
  swatch?: string,
): Promise<void> {
  await page.mouse.dblclick(x, y);
  await page.waitForSelector('[data-testid="sticky-textarea"]');
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  if (swatch) await page.click(`[data-testid="swatch-${swatch}"]`);
  await page.waitForTimeout(60);
}

async function allTexts(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="group"][aria-label="Sticky note"] .sticky-note-text')].map(
      (e) => e.textContent ?? '',
    ),
  );
}

// TC-19: reload the page (no server restart); everything comes back. A second tab
// joins, the first tab closes, and the surviving tab still sees everything.
test('TC-19: reload restores notes, position, text and colour', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  // Story 5: create the board via the UI so its link exists before editing.
  const id = await createBoardViaUi(pageA);

  await addNote(pageA, 400, 300, 'first note', 'pink');
  await addNote(pageA, 700, 420, 'second note with a longer line\nand a second line');
  await addNote(pageA, 520, 640, 'third', 'blue');
  await waitUntil(() => getNoteCount(pageA), (n) => n === 3);
  const before = await snap(pageA);

  // Reload the same tab -> restored from storage.
  await pageA.reload();
  await waitForConnected(pageA);
  await waitUntil(() => getNoteCount(pageA), (n) => n === 3);
  expect(await snap(pageA)).toBe(before);

  // A second browser context that joins mid-session sees the same notes.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(`/b/${id}`);
  await waitForConnected(pageB);
  await waitUntil(() => getNoteCount(pageB), (n) => n === 3);
  expect(await snap(pageB)).toBe(before);

  // First tab closes; the second reloads and still sees everything.
  await ctxA.close();
  await pageB.reload();
  await waitForConnected(pageB);
  await waitUntil(() => getNoteCount(pageB), (n) => n === 3);
  expect(await snap(pageB)).toBe(before);

  await ctxB.close();
});

// TC-20: kill and restart the server; the board is rebuilt from disk.
test('TC-20: notes survive a full server restart', async ({ browser }) => {
  test.setTimeout(180_000);
  const port = 8791;
  const persistDir = fs.mkdtempSync('/tmp/vidi6-tc20-');
  let proc: WranglerProc | null = null;
  const ctx = await browser.newContext();
  try {
    proc = await startWrangler({ port, testHooks: true, persistDir });
    const page = await ctx.newPage();
    const id = await createBoardViaUi(page, `${proc.url}/`);

    await addNote(page, 400, 300, 'persisted before restart', 'violet');
    await addNote(page, 720, 480, 'also persisted');
    await waitUntil(() => getNoteCount(page), (n) => n === 2);
    const before = await snap(page);
    await page.close();

    await proc.kill();
    proc = null;

    // Restart the server against the SAME persistence directory.
    proc = await startWrangler({ port, testHooks: true, persistDir });

    const page2 = await ctx.newPage();
    await page2.goto(`${proc.url}/b/${id}`);
    await waitForConnected(page2);
    await waitUntil(() => getNoteCount(page2), (n) => n === 2);
    expect(await snap(page2)).toBe(before);
    await page2.close();
  } finally {
    await ctx.close();
    if (proc) await proc.kill();
    cleanupDir(persistDir);
  }
});

// TC-21: a large (PERSIST_TESTED_NOTES) board is served quickly and completely.
test('TC-21: large board loads within budget and text matches', async ({ browser }) => {
  test.setTimeout(180_000);
  const port = 8792;
  const id = newBoardId();
  let proc: WranglerProc | null = null;
  const ctx = await browser.newContext();
  try {
    proc = await startWrangler({ port, testHooks: true });

    // Seed a large board directly into storage via the test route.
    const seed = (await (
      await fetch(`${proc.url}/__test/seed?room=${id}&count=${PERSIST_TESTED_NOTES}&seed=1`, {
        method: 'POST',
      })
    ).json()) as { notes: number };
    expect(seed.notes).toBe(PERSIST_TESTED_NOTES);

    // Force a cold reload and assert the server-side load stays within budget.
    await fetch(`${proc.url}/__test/reload?room=${id}`, { method: 'POST' });
    const st = (await (await fetch(`${proc.url}/__test/state?room=${id}`)).json()) as {
      state: string;
      notes: number;
      loadMs: number;
    };
    expect(st.state).toBe('ready');
    expect(st.notes).toBe(PERSIST_TESTED_NOTES);
    expect(st.loadMs).toBeLessThan(BOARD_LOAD_BUDGET_MS);

    // The browser must render every note, with correct text.
    const page = await ctx.newPage();
    await page.goto(`${proc.url}/b/${id}`);
    await waitForConnected(page);
    await waitUntil(() => getNoteCount(page), (n) => n === PERSIST_TESTED_NOTES, 60_000);

    const expected = Array.from({ length: PERSIST_TESTED_NOTES }, (_, i) => `Note ${i}`).sort();
    const texts = (await allTexts(page)).sort();
    expect(texts.length).toBe(PERSIST_TESTED_NOTES);
    expect(texts).toEqual(expected);
  } finally {
    await ctx.close();
    if (proc) await proc.kill();
    if (proc) cleanupDir(proc.persistDir);
  }
});
