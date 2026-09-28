// E2E tests for story 7 (select, move, resize and delete several objects at
// once): TC-32 to TC-36. Runs against `dev:test` (wrangler dev) like the
// other e2e specs; multi-participant tests use isolated browser contexts.

import { expect, test } from '@playwright/test';
import {
  connectParticipants,
  disposeAll,
  expectWithin,
  getNotes,
  sortedNotes,
} from './helpers/participants';
import { openBoard, setCamera, newBoardId } from './helpers/board';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
} from '../../src/shared/config';

type Page = import('@playwright/test').Page;

/** Seeding helper (test mode only): creates a note centred on (x, y). */
async function createNoteAt(page: Page, x: number, y: number): Promise<string> {
  const id = await page.evaluate(
    ([px, py]) => window.__vidi6?.createSticky(px, py) ?? null,
    [x, y],
  );
  if (id === null) throw new Error('seed hook unavailable');
  await page.locator('[data-testid="sticky-note"][data-id="' + id + '"]').waitFor();
  return id;
}

async function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__vidi6?.getSelectedIds() ?? []);
}

/** Shift+drag a marquee from (x1,y1) to (x2,y2) in screen space. */
async function marquee(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Plain drag of an object between screen points (10 intermediate steps). */
async function drag(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 10 });
  await page.mouse.up();
}

/** Drags the named resize handle (found by accessible name) to (x2, y2). */
async function dragHandleTo(page: Page, name: string, x2: number, y2: number): Promise<void> {
  const box = (await page.getByRole('button', { name }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 10 });
  await page.mouse.up();
}

test('TC-32: marquee selects only fully-inside notes (A inside, B half, C outside)', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);
  // createSticky centres the note on the point:
  const a = await createNoteAt(page, 400, 400); // (300..500)²: fully inside (290..560)²
  const b = await createNoteAt(page, 550, 400); // (450..650)²: half inside
  const c = await createNoteAt(page, 800, 400); // (700..900)²: outside
  expect(await selectedIds(page)).toHaveLength(0);

  await marquee(page, 290, 290, 560, 560);

  expect(await selectedIds(page)).toEqual([a]);
  expect(await selectedIds(page)).not.toContain(b);
  expect(await selectedIds(page)).not.toContain(c);
});

/** A 3×2 note grid whose bounds are (10..610)² (notes 200×200, spacing 200). */
const GRID_CENTERS: Array<[number, number]> = [
  [110, 110],
  [310, 110],
  [510, 110],
  [110, 310],
  [310, 310],
  [510, 310],
];

async function seedGridPlusOne(page: Page): Promise<{ six: string[]; seventh: string }> {
  const six: string[] = [];
  for (const [x, y] of GRID_CENTERS) six.push(await createNoteAt(page, x, y));
  const seventh = await createNoteAt(page, 900, 110); // (800..1000)²: outside the marquee
  return { six, seventh };
}

test('TC-33: group move + bounding-box resize keep layout, squareness, and clamp at the minimum', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);
  const { six, seventh } = await seedGridPlusOne(page);

  // Marquee the grid: (10..610)² fully inside (0..620)²; the 7th is not.
  await marquee(page, 0, 0, 620, 620);
  expect([...(await selectedIds(page))].sort()).toEqual([...six].sort());

  // --- Group move: drag one note +300 world units; all six move, and all
  // six come above the unselected 7th.
  const z = async (id: string): Promise<number> =>
    (await getNotes(page)).find((n) => n.id === id)!.z;
  const zSeventh = await z(seventh);
  const before = await getNotes(page);
  const noteEl = page.locator('[data-testid="sticky-note"][data-id="' + six[0] + '"]');
  const b0 = (await noteEl.boundingBox())!;
  await drag(page, b0.x + 10, b0.y + 10, b0.x + 310, b0.y + 10);

  let notes = await getNotes(page);
  for (const id of six) {
    const n0 = before.find((n) => n.id === id)!;
    const n1 = notes.find((n) => n.id === id)!;
    expect(n1.x).toBeCloseTo(n0.x + 300, 0.5);
    expect(n1.y).toBeCloseTo(n0.y, 0.5);
    expect(await z(id)).toBeGreaterThan(zSeventh);
  }
  expect(notes.find((n) => n.id === seventh)!.x).toBeCloseTo(
    before.find((n) => n.id === seventh)!.x,
    0.5,
  );

  // --- Group resize: bounds are now (310..910)×(10..410). Drag the se handle
  // by (+60,+40) → uniform scale 1.1: notes 220×220 (square), gaps 220.
  await dragHandleTo(page, 'Resize bottom-right', 970, 450);

  notes = await getNotes(page);
  for (const n of notes.filter((n) => six.includes(n.id))) {
    expect(n.width).toBeCloseTo(220, 0.5);
    expect(n.height).toBeCloseTo(220, 0.5); // square
  }
  // Gaps scale too: top-row centres were 200 apart, now 220 apart.
  const rowTop = notes
    .filter((n) => six.includes(n.id) && n.y < 110)
    .sort((p, q) => p.x - q.x);
  expect(rowTop[1].x - rowTop[0].x).toBeCloseTo(220, 0.5);

  // --- Shrink past the minimum: bounds are (310..970)×(10..450). Drag the se
  // handle to (310+660*0.22, 10+440*0.22) → requested notes 48.4 < 50 → the
  // clamp stops exactly at STICKY_MIN_SIZE_WORLD.
  await dragHandleTo(page, 'Resize bottom-right', 310 + 660 * 0.22, 10 + 440 * 0.22);

  notes = await getNotes(page);
  for (const n of notes.filter((n) => six.includes(n.id))) {
    expect(n.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 0.5);
    expect(n.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 0.5);
  }
});

test('TC-34: nudge moves the whole selection; Delete removes all selected', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);
  const { six, seventh } = await seedGridPlusOne(page);

  await marquee(page, 0, 0, 620, 620);
  expect(await selectedIds(page)).toHaveLength(6);

  const camBefore = await page.evaluate(() => window.__vidi6?.getCamera());
  const before = await getNotes(page);

  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');

  const expectedDx = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
  const notes = await getNotes(page);
  for (const id of six) {
    const n0 = before.find((n) => n.id === id)!;
    const n1 = notes.find((n) => n.id === id)!;
    expect(n1.x).toBeCloseTo(n0.x + expectedDx, 0.5);
    expect(n1.y).toBeCloseTo(n0.y, 0.5);
  }
  // The camera and the unselected note did not move.
  expect(await page.evaluate(() => window.__vidi6?.getCamera())).toEqual(camBefore);
  expect(notes.find((n) => n.id === seventh)!.x).toBeCloseTo(
    before.find((n) => n.id === seventh)!.x,
    0.5,
  );

  await page.keyboard.press('Delete');

  const after = await getNotes(page);
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(seventh);
  expect(await selectedIds(page)).toHaveLength(0);
});

test('TC-35: colleague deletes one of my selected notes; I keep the rest, Delete removes exactly those', async ({
  browser,
}) => {
  const boardId = newBoardId();
  const [lee, sam] = await connectParticipants(browser, boardId, 2);
  try {
    for (const p of [lee, sam]) await setCamera(p.page, 0, 0, 1);

    // 20 notes: 5 columns × 4 rows, spacing 140 → bounds (5..765)×(5..625).
    const ids: string[] = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 5; col++) {
        ids.push(await createNoteAt(lee.page, 105 + 140 * col, 105 + 140 * row));
      }
    }
    // Lee selects the top-left 2×2 block (bounds (5..345)²) with a marquee.
    await marquee(lee.page, 0, 0, 350, 350);
    const leeSelection = await selectedIds(lee.page);
    expect(leeSelection).toHaveLength(4);
    await expect(lee.page.getByText('4 selected')).toBeVisible();

    // Sam selects one of Lee's notes (centre (105,245)) and deletes it.
    await expectWithin(async () =>
      (await getNotes(sam.page)).some((n) => n.x === 5 && n.y === 145),
    ).toBe(true);
    const victim = (await getNotes(sam.page)).find((n) => n.x === 5 && n.y === 145)!;
    expect(leeSelection).toContain(victim.id);
    await sam.page.mouse.click(105, 245);
    await sam.page.keyboard.press('Delete');

    // Lee sees the note disappear; the bar now reads "3 selected".
    await expectWithin(async () => (await getNotes(lee.page)).find((n) => n.id === victim.id)).toBeUndefined();
    await expectWithin(async () => lee.page.getByText('3 selected').count()).toBe(1);

    // Lee deletes the remainder: exactly those 3 go.
    await lee.page.keyboard.press('Delete');
    await expectWithin(async () => (await getNotes(lee.page)).length).toBe(20 - 1 - 3);
    await expectWithin(async () => (await getNotes(sam.page)).length).toBe(20 - 1 - 3);
  } finally {
    await disposeAll([lee, sam]);
  }
});

test('TC-36: full-capacity concurrent group moves converge to identical finals', async ({
  browser,
}) => {
  // Spec scope: "All pass in chromium; TC-32 also in firefox and webkit" —
  // the 5-way concurrent input is only required on chromium.
  test.skip(test.info().project.name !== 'chromium', 'TC-36 is scoped to chromium');
  const boardId = newBoardId();
  const participants = await connectParticipants(browser, boardId, MAX_CONCURRENT_EDITORS);
  try {
    for (const p of participants) await setCamera(p.page, 0, 0, 1);

    // 5 groups × 2 notes; group i occupies x (10+240i..210+240i), y (0..400).
    const first = participants[0];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      await createNoteAt(first.page, 110 + 240 * i, 100);
      await createNoteAt(first.page, 110 + 240 * i, 300);
    }

    // Each context selects its own group and drags it +20 world units, all
    // at the same time (each context first waits for the seeded notes).
    // The 20-unit step is smaller than the 30-unit gap between groups, so
    // no drag path ever crosses another group's marquee start point (the
    // marquee starts in the empty strip at the group's left edge).
    await Promise.all(
      participants.map(async (p, i) => {
        await expectWithin(async () => (await getNotes(p.page)).length).toBe(MAX_CONCURRENT_EDITORS * 2);
        const gx1 = 240 * i;
        const gx2 = 240 * i + 220;
        // Under full parallel load a context's input pipeline can drop a
        // pointerdown; retry the marquee if so.
        let sel: string[] = [];
        for (let attempt = 0; attempt < 3 && sel.length !== 2; attempt++) {
          await marquee(p.page, gx1, 0, gx2, 400);
          sel = await selectedIds(p.page);
        }
        expect(sel).toHaveLength(2);
        await drag(p.page, 110 + 240 * i, 100, 130 + 240 * i, 100);
      }),
    );

    // Every context shows the same board (absolute writes converge); poll
    // until the finals have propagated within the live-update budget.
    await expect.poll(async () => {
      const all = await Promise.all(participants.map((p) => sortedNotes(p.page)));
      const first = JSON.stringify(all[0]);
      return all.every((ns) => JSON.stringify(ns) === first) ? 'converged' : 'pending';
    }, { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS }).toBe('converged');
    const finals = await Promise.all(participants.map((p) => sortedNotes(p.page)));
    for (const notes of finals) {
      expect(notes).toHaveLength(MAX_CONCURRENT_EDITORS * 2);
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        // Final centres: x = 110 + 240i + 20 = 130 + 240i.
        const group = notes.filter((n) => Math.abs(n.x + 100 - (130 + 240 * i)) < 1);
        expect(group).toHaveLength(2);
      }
    }
    for (let i = 1; i < finals.length; i++) {
      expect(finals[i]).toEqual(finals[0]);
    }
  } finally {
    await disposeAll(participants);
  }
});
