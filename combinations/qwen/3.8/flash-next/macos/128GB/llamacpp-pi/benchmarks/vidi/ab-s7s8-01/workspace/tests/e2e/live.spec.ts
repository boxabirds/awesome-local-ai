// Story 3 — live collaboration across REAL browser contexts (tasks 8+9).
// Every context is a separate browser context (its own profiles, sockets and
// Y.Doc instances); the room is shared through the /b/<boardId> deep link.
// Latencies are measured against the PRD budget (LIVE_UPDATE_LATENCY_BUDGET_MS
// = 1000ms); the last two scenarios are @nightly per the test strategy.

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { stickyCenter } from './helpers/board';
import {
  allSnaps,
  boardState,
  colorSticky,
  deleteSticky,
  errorCollector,
  moveSticky,
  notePoint,
  createRoom,
  openRoom,
  seedSticky,
  typeSticky,
  typeStickyViaDoc,
  waitConverged,
  waitNoteCount,
} from './helpers/live';
import { CATCH_UP_TEST_OUTAGE_MS, LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

async function makeClients(browser: import('@playwright/test').Browser, n: number, room: string): Promise<Page[]> {
  const pages: Page[] = [];
  for (let i = 0; i < n; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    pages.push(page);
  }
  await Promise.all(pages.map((p) => openRoom(p, room)));
  return pages;
}

async function closeClients(contexts: BrowserContext[]): Promise<void> {
  for (const c of contexts) await c.close();
}

test('TC-22: every kind of Alex change is visible to Sam within the latency budget', async ({ browser, request }) => {
  const room = await createRoom(request);
  const pages = await makeClients(browser, 2, room);
  const [alex, sam] = pages;
  const errors = errorCollector(sam);

  // Create via a REAL double-click on empty board space.
  const t0 = Date.now();
  await alex.mouse.dblclick(640, 400);
  await expect
    .poll(() => alex.evaluate(() => (window as unknown as { __vidi6?: { snapshot(): { id: string }[] } }).__vidi6!.snapshot()).then((s) => s.length), { timeout: 2000 })
    .toBe(1);
  const created = await alex.evaluate(() => (window as unknown as { __vidi6?: { snapshot(): { id: string }[] } }).__vidi6!.snapshot());
  const id = created[0].id;
  await waitNoteCount(sam, 1, LIVE_UPDATE_LATENCY_BUDGET_MS);
  const elapsed = Date.now() - t0;
  expect(elapsed, 'create propagation').toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);

  // Move.
  await moveSticky(alex, id, 400, 250);
  const moveTime = await waitConverged(pages);
  expect(moveTime, 'move propagation').toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);

  // Recolour.
  await colorSticky(alex, id, 'pink');
  const colorTime = await waitConverged(pages);
  expect(colorTime, 'recolour propagation').toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);

  // Type.
  await typeSticky(alex, id, 'hello from alex');
  const typeTime = await waitConverged(pages);
  expect(typeTime, 'text propagation').toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);

  // Delete (via the note toolbar: select first, then press delete). Aim at
  // the note's top-left corner — its centre is under the zoom bar here.
  const c = await notePoint(alex, id);
  await alex.mouse.click(c.x, c.y);
  await alex.getByTestId('note-delete').click();
  const delTime = await waitConverged(pages);
  expect(delTime, 'delete propagation').toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);

  expect(errors).toEqual([]);
  await closeClients(pages.map((p) => p.context()));
});

test('TC-23: both typing into one note at once → identical text, every character kept', async ({ browser, request }) => {
  const room = await createRoom(request);
  const pages = await makeClients(browser, 2, room);
  const [alex, sam] = pages;

  const id = await seedSticky(alex, 0, 0);
  await waitConverged(pages);

  // Both open the SAME note in their editors (real double-clicks).
  for (const p of [alex, sam]) {
    const c = await stickyCenter(p, id);
    await p.mouse.dblclick(c.x, c.y);
    await expect(p.getByTestId('sticky-textarea')).toBeVisible();
  }

  // Type concurrently — Playwright drives each browser independently.
  await Promise.all([
    alex.getByTestId('sticky-textarea').pressSequentially('AAA', { delay: 15 }),
    sam.getByTestId('sticky-textarea').pressSequentially('BBB', { delay: 15 }),
  ]);

  // Same text on both screens…
  await waitConverged(pages, 5000);
  const [snapA, snapB] = await Promise.all([
    alex.evaluate(() => (window as unknown as { __vidi6?: { snapshot(): { text: string }[] } }).__vidi6!.snapshot()),
    sam.evaluate(() => (window as unknown as { __vidi6?: { snapshot(): { text: string }[] } }).__vidi6!.snapshot()),
  ]);
  expect(snapA.length).toBe(1);
  expect(snapA[0].text.length).toBe(6);
  expect(snapA[0].text).toBe(snapB[0].text);
  expect([...snapA[0].text].sort().join('')).toBe('AAABBB');

  // …and Sam's STILL-OPEN editor shows the final merged text live (remote
  // updates reach an active editor).
  await expect(sam.getByTestId('sticky-textarea')).toHaveValue(snapA[0].text);
  await closeClients(pages.map((p) => p.context()));
});

test('TC-24: both drag the same note at once → identical settled position', async ({ browser, request }) => {
  const room = await createRoom(request);
  const pages = await makeClients(browser, 2, room);
  const [alex, sam] = pages;
  const id = await seedSticky(alex, 0, 0);
  await waitConverged(pages);

  // Each drags the note in opposite directions simultaneously.
  const drag = async (p: Page, dx: number, dy: number) => {
    const c = await stickyCenter(p, id);
    await p.mouse.move(c.x, c.y);
    await p.mouse.down();
    await p.mouse.move(c.x + dx, c.y + dy, { steps: 6 });
    await p.mouse.up();
  };
  await Promise.all([drag(alex, -150, 0), drag(sam, 150, 0)]);

  // Identical final position on both within the budget (last write wins —
  // WHICH write wins is not asserted, only that both agree).
  const settled = await waitConverged(pages, 5000);
  expect(settled).toBeLessThanOrEqual(5000);
  const snaps = (await allSnaps(pages)).split('|').map((s) => JSON.parse(s) as { x: number }[]);
  expect(snaps[0][0].x).not.toBe(-100); // the note actually moved (seed x = 0 → stored top-left −100)
  await closeClients(pages.map((p) => p.context()));
});

test('TC-25: Alex deletes the note Sam is editing — editor and note vanish, no console errors', async ({ browser, request }) => {
  const room = await createRoom(request);
  const pages = await makeClients(browser, 2, room);
  const [alex, sam] = pages;
  const errors = errorCollector(sam);

  const id = await seedSticky(alex, 0, 0);
  await waitConverged(pages);

  // Sam edits.
  const c = await stickyCenter(sam, id);
  await sam.mouse.dblclick(c.x, c.y);
  await expect(sam.getByTestId('sticky-textarea')).toBeVisible();

  // Alex deletes it while Sam types.
  await Promise.all([
    sam.getByTestId('sticky-textarea').pressSequentially('words', { delay: 10 }),
    (async () => {
      const ac = await stickyCenter(alex, id);
      await alex.mouse.click(ac.x, ac.y);
      await alex.getByTestId('note-delete').click();
    })(),
  ]);

  // Sam's editor and note disappear; nothing throws.
  await expect(sam.getByTestId('sticky-textarea')).toHaveCount(0, { timeout: 5000 });
  await waitConverged(pages, 5000);
  expect(errors).toEqual([]);
  await closeClients(pages.map((p) => p.context()));
});

test('TC-26: full-capacity session — 5 contexts create and move, all snapshots end identical', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const room = await createRoom(request);
  const pages = await makeClients(browser, MAX_CONCURRENT_EDITORS, room);

  // 5 notes created per context, each propagation inside the budget.
  const maxLatency: number[] = [];
  for (let r = 0; r < 5; r++) {
    for (const p of pages) {
      await seedSticky(p, (r - 2) * 300 + Math.random() * 40, (pages.indexOf(p) - 2) * 300);
      maxLatency.push(await waitConverged(pages));
    }
  }
  // Then 5 moves per context.
  for (let r = 0; r < 5; r++) {
    for (const p of pages) {
      const snap = await p.evaluate(() => (window as unknown as { __vidi6?: { snapshot(): { id: string; x: number }[] } }).__vidi6!.snapshot());
      if (snap.length === 0) continue;
      const target = snap[Math.floor(Math.random() * snap.length)].id;
      await moveSticky(p, target, Math.random() * 800 - 400, Math.random() * 800 - 400);
      maxLatency.push(await waitConverged(pages));
    }
  }

  const over = maxLatency.filter((t) => t > LIVE_UPDATE_LATENCY_BUDGET_MS);
  expect(over.length, `${over.length}/${maxLatency.length} changes exceeded the ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms budget`).toBe(0);
  const final = await allSnaps(pages);
  expect(new Set(final.split('|')).size).toBe(1);
  expect((JSON.parse(final.split('|')[0]) as unknown[]).length).toBe(25);
  await closeClients(pages.map((p) => p.context()));
});

test('TC-27: flaky Wi-Fi — 30s offline, both keep editing, everything converges after reconnect', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const room = await createRoom(request);
  const pages = await makeClients(browser, 2, room);
  const [alex, sam] = pages;

  // Alex drops offline; BOTH keep working (3 notes each).
  await alex.context().setOffline(true);
  const states: string[] = [];
  const sampler = setInterval(async () => {
    try {
      states.push(await alex.evaluate(() => (window as unknown as { __vidi6?: { connectionState(): string } }).__vidi6!.connectionState()));
    } catch {
      /* page mid-navigation or closed */
    }
  }, 250);

  await seedSticky(alex, 0, 0);
  await seedSticky(alex, 250, 0);
  await seedSticky(alex, 500, 0);
  await seedSticky(sam, 0, 250);
  await seedSticky(sam, 250, 250);
  await seedSticky(sam, 500, 250);

  // Outage: the full CATCH_UP_TEST_OUTAGE_MS window.
  await new Promise((r) => setTimeout(r, CATCH_UP_TEST_OUTAGE_MS));
  // During the outage the badge path must show the offline state. The socket
  // is black-holed (no RST) under context.setOffline — the app detects the
  // dead link via the browser's network state (connectBoard listens for the
  // window 'offline' event), so 'reconnecting' shows up immediately.
  expect(states).toContain('reconnecting');

  // Back online: both catch up to six notes and identical snapshots.
  await alex.context().setOffline(false);
  await Promise.all([waitNoteCount(alex, 6, 30_000), waitNoteCount(sam, 6, 30_000)]);
  clearInterval(sampler);
  await waitConverged(pages, 10_000);
  await closeClients(pages.map((p) => p.context()));
});

test('TC-28 negative: a remote selection and editor are not mirrored', async ({ browser, request }) => {
  const room = await createRoom(request);
  const pages = await makeClients(browser, 2, room);
  const [alex, sam] = pages;
  const id = await seedSticky(alex, 0, 0);
  await waitConverged(pages);

  const c = await stickyCenter(alex, id);
  await alex.mouse.dblclick(c.x, c.y);
  await expect(alex.getByTestId('sticky-textarea')).toBeVisible();
  await alex.waitForTimeout(500); // let any presence-style traffic settle

  // Sam must show NEITHER a selection outline NOR an editor.
  await expect(sam.getByTestId('sticky-textarea')).toHaveCount(0);
  const state = await boardState(sam);
  expect(state.selectedId).toBeNull();
  expect(state.editingId).toBeNull();
  // (And Alex really is editing — the negative check means something.)
  const alexState = await boardState(alex);
  expect(alexState.editingId).not.toBeNull();
  await closeClients(pages.map(p => p.context()));
});

test('@nightly TC-29: 45s idle — the badge never leaves "connected"', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const room = await createRoom(request);
  const pages = await makeClients(browser, 2, room);

  // Two idle clients for 45 real seconds; sample connection state on both
  // every 250ms. The provider options (resyncInterval + awareness relay)
  // must keep y-websocket's 30s no-message timeout from ever firing.
  const bad: string[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 45_000) {
    for (const p of pages) {
      const s = await p.evaluate(() => (window as unknown as { __vidi6?: { connectionState(): string } }).__vidi6!.connectionState());
      if (s === 'reconnecting' || s === 'connecting') bad.push(s);
    }
    await pages[0].waitForTimeout(250);
  }
  expect(bad, `states left 'connected': ${JSON.stringify(bad.slice(0, 5))}`).toEqual([]);

  // After the idle window the room still relays: an edit round-trips.
  const id = await seedSticky(pages[0], 0, 0);
  await waitConverged(pages, 3000);
  expect((await allSnaps(pages)).includes(id)).toBe(true);
  await closeClients(pages.map(p => p.context()));
});

test('@nightly TC-30: 60s capacity soak — 5 clients, every change inside budget', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const room = await createRoom(request);
  const pages = await makeClients(browser, MAX_CONCURRENT_EDITORS, room);

  let rng = 42; // seeded (mulberry32) — change to re-run the exact same soak
  const rand = () => {
    rng = (rng + 0x6d2b79f5) | 0;
    let t = Math.imul(rng ^ (rng >>> 15), 1 | rng);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const latencies: number[] = [];
  const broken: string[] = [];
  const states: string[] = [];
  const t0 = Date.now();
  let counter = 0;
  while (Date.now() - t0 < 60_000) {
    const sender = pages[counter % pages.length];
    const snap = await sender.evaluate(() => (window as unknown as { __vidi6?: { snapshot(): { id: string; x: number }[] } }).__vidi6!.snapshot());
    const pick = snap[Math.floor(rand() * Math.max(1, snap.length))]?.id;
    const kind = Math.floor(rand() * 5);
    if (kind === 0 || snap.length < 3) {
      await seedSticky(sender, rand() * 900 - 450, rand() * 900 - 450);
    } else if (kind === 1 && pick) {
      await moveSticky(sender, pick, rand() * 900 - 450, rand() * 900 - 450);
    } else if (kind === 2 && pick) {
      await colorSticky(sender, pick, ['orange', 'green', 'blue', 'pink', 'violet'][Math.floor(rand() * 5)]);
    } else if (kind === 3 && pick) {
      // Doc-level typing (see typeStickyViaDoc): in the soak notes overlap,
      // and the editor hit-test no longer identifies the target reliably.
      await typeStickyViaDoc(sender, pick, 'x');
    } else if (pick) {
      await deleteSticky(sender, pick);
    } else {
      await seedSticky(sender, rand() * 900 - 450, rand() * 900 - 450);
    }
    try {
      latencies.push(await waitConverged(pages)); // budget = default arg
    } catch {
      broken.push(`op ${counter} kind ${kind}`);
      await new Promise((r) => setTimeout(r, 2000)); // give it time to recover
    }
    if (counter % 20 === 0) {
      for (const p of pages) {
        const s = await p.evaluate(() => (window as unknown as { __vidi6?: { connectionState(): string } }).__vidi6!.connectionState());
        states.push(s);
      }
    }
    counter++;
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const pct = (q: number) => sorted[Math.floor(q * (sorted.length - 1))];
  console.log(
    `TC-30 soak: ${latencies.length} changes, p50=${pct(0.5)}ms p95=${pct(0.95)}ms max=${sorted.at(-1)}ms`,
  );
  expect(broken.length, `changes that did not converge in budget: ${broken.slice(0, 5).join(', ')}`).toBe(0);
  expect(states).not.toContain('reconnecting');
  const final = await allSnaps(pages);
  expect(new Set(final.split('|')).size).toBe(1);
  await closeClients(pages.map(p => p.context()));
});