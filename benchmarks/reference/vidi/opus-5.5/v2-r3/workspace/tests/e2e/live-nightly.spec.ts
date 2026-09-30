// Nightly (run with `npm run test:e2e:nightly`; excluded from `npm run test:e2e`).
import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  RECONNECT_MAX_BACKOFF_MS,
  STICKY_COLORS,
} from '../../src/shared/config';
import { WORDS, pick, pickKind, seededRandom } from '../fixtures/random-ops';
import { setCamera } from './helpers/board';
import { centre, editor, noteId } from './helpers/notes';
import {
  closeAll,
  expectSameBoards,
  openParticipants,
  printLatencyReport,
  recordLatency,
  seenEvents,
  type Participant,
} from './helpers/participants';

/** TC-29 idle period: longer than y-websocket's 30 s no-message watchdog. */
const IDLE_MS = 45_000;
/** TC-30 soak duration (PRD live.capacity verification: one minute). */
const SOAK_MS = 60_000;

let participants: Participant[] = [];
test.afterEach(async () => {
  await closeAll(participants);
  participants = [];
});

test('TC-29: an idle connection stays connected for 45 s; teardown stops reconnecting @nightly', async ({
  browser,
}) => {
  test.setTimeout(IDLE_MS + RECONNECT_MAX_BACKOFF_MS + 4 * E2E_EVENTUAL_TIMEOUT_MS);
  participants = await openParticipants(browser, ['Alex', 'Sam']);
  const states = new Set<string>();
  const end = Date.now() + IDLE_MS;
  while (Date.now() < end) {
    for (const p of participants) states.add(String(await p.page.evaluate(() => window.__vidi6?.connectionState)));
    await participants[0].page.waitForTimeout(1000);
  }
  expect([...states]).toEqual(['connected']);
  for (const p of participants) {
    const badges = (await seenEvents(p.page)).filter((e) => e.key === 'badge').map((e) => e.value);
    expect(badges).not.toContain('Reconnecting…');
    expect(await p.page.evaluate(() => window.__vidi6Sockets)).toBe(1);
  }

  // Teardown: unmounting destroys the provider; no reconnect attempts follow.
  const alex = participants[0].page;
  await alex.evaluate(() => window.__vidi6Unmount!());
  await alex.waitForTimeout(RECONNECT_MAX_BACKOFF_MS);
  expect(await alex.evaluate(() => window.__vidi6Sockets)).toBe(1);
});

// ---------------------------------------------------------------------------
// TC-30: capacity soak through the real UI.

const ZOOM = 0.4;
const ROW = 140;
const BAND = 50; // note centres of participant i lie in [70 + ROW*i, 70 + ROW*i + BAND]
const X_MIN = 150;
const X_MAX = 1000;
const MIN_GAP = 90; // screen px between own note centres (notes are 80 px at ZOOM)
const EMPTY_X = 1200;
const COLOR_LABELS = Object.keys(STICKY_COLORS).map((c) => `${c[0].toUpperCase()}${c.slice(1)} colour`);

interface Soaker {
  p: Participant;
  band: number;
  rand: () => number;
  owned: Set<string>;
  /** Every note this participant created (including ones it later deleted). */
  created: Set<string>;
  ops: Record<string, number>;
}

function note(page: Page, id: string) {
  return page.locator(`[data-note-id="${id}"]`);
}

async function ownCentres(s: Soaker): Promise<{ x: number; y: number }[]> {
  return Promise.all([...s.owned].map((id) => centre(note(s.p.page, id))));
}

/** A free spot in the participant's band, or null when crowded. */
async function freeSpot(s: Soaker, except?: { x: number; y: number }): Promise<{ x: number; y: number } | null> {
  const taken = (await ownCentres(s)).filter((c) => !except || Math.hypot(c.x - except.x, c.y - except.y) > 1);
  for (let attempt = 0; attempt < 10; attempt++) {
    const spot = {
      x: Math.round(X_MIN + s.rand() * (X_MAX - X_MIN)),
      y: Math.round(70 + ROW * s.band + s.rand() * BAND),
    };
    if (taken.every((c) => Math.hypot(c.x - spot.x, c.y - spot.y) > MIN_GAP)) return spot;
  }
  return null;
}

async function deselect(s: Soaker): Promise<void> {
  await s.p.page.mouse.click(EMPTY_X, 70 + ROW * s.band + BAND / 2);
}

async function soakOp(s: Soaker): Promise<void> {
  const page = s.p.page;
  const ids = [...s.owned];
  let kind = ids.length === 0 ? 'create' : pickKind(s.rand());
  if (kind === 'delete' && ids.length < 3) kind = 'create';
  s.ops[kind] = (s.ops[kind] ?? 0) + 1;
  switch (kind) {
    case 'create': {
      const spot = await freeSpot(s);
      if (!spot) return;
      await page.mouse.dblclick(spot.x, spot.y);
      const editing = page.locator('[data-editing="true"]');
      await expect(editing).toHaveCount(1);
      const id = await noteId(editing);
      s.owned.add(id);
      s.created.add(id);
      await page.keyboard.type(pick(s.rand, WORDS), { delay: 20 });
      await page.keyboard.press('Escape');
      await deselect(s);
      return;
    }
    case 'type': {
      const id = pick(s.rand, ids);
      await note(page, id).dblclick();
      await expect(editor(page)).toBeFocused();
      await editor(page).evaluate((ta: HTMLTextAreaElement) => ta.setSelectionRange(ta.value.length, ta.value.length));
      await page.keyboard.type(` ${pick(s.rand, WORDS)}`, { delay: 20 });
      await page.keyboard.press('Escape');
      await deselect(s);
      return;
    }
    case 'move': {
      const id = pick(s.rand, ids);
      const from = await centre(note(page, id));
      const to = await freeSpot(s, from);
      if (!to) return;
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
      await deselect(s);
      return;
    }
    case 'recolour': {
      const id = pick(s.rand, ids);
      await note(page, id).click();
      await page.getByRole('button', { name: pick(s.rand, COLOR_LABELS) }).click();
      await deselect(s);
      return;
    }
    case 'delete': {
      const id = pick(s.rand, ids);
      await note(page, id).click();
      await page.getByRole('button', { name: 'Delete note' }).click();
      s.owned.delete(id);
      return;
    }
  }
}

test('TC-30: MAX_CONCURRENT_EDITORS people edit continuously for 60 s and end identical @nightly', async ({
  browser,
}) => {
  test.setTimeout(SOAK_MS + 10 * E2E_EVENTUAL_TIMEOUT_MS);
  const seed = (Date.now() ^ 0x30) >>> 0;
  console.log(`TC-30 seed ${seed}`);
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `P${i + 1}`);
  participants = await openParticipants(browser, names);
  await Promise.all(participants.map((p) => setCamera(p.page, { x: 0, y: 0, zoom: ZOOM })));
  const soakers: Soaker[] = participants.map((p, i) => ({
    p,
    band: i,
    rand: seededRandom(seed + i),
    owned: new Set(),
    created: new Set(),
    ops: {},
  }));

  const end = Date.now() + SOAK_MS;
  await Promise.all(
    soakers.map(async (s) => {
      while (Date.now() < end) await soakOp(s);
    }),
  );

  const board = await expectSameBoards(participants, 2 * E2E_EVENTUAL_TIMEOUT_MS);
  expect(board.map((n) => n.id).sort()).toEqual(soakers.flatMap((s) => [...s.owned]).sort());
  for (const s of soakers) console.log(`TC-30 ${s.p.name} ops ${JSON.stringify(s.ops)}`);

  // Latency of every change the owner's screen showed that another screen also showed.
  const logs = await Promise.all(participants.map((p) => seenEvents(p.page)));
  soakers.forEach((s, i) => {
    for (const e of logs[i]) {
      if (!s.created.has(e.id)) continue;
      logs.forEach((other, j) => {
        if (j === i) return;
        const r = other.find((o) => o.id === e.id && o.key === e.key && o.value === e.value && o.t >= e.t - 5);
        if (r) recordLatency(`${s.p.name}→${participants[j].name} ${e.key}`, Math.max(0, r.t - e.t), true);
      });
    }
  });
  printLatencyReport('TC-30 capacity soak');
});
