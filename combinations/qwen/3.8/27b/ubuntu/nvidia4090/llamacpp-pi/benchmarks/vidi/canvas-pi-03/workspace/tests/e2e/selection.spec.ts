import { test, expect } from '@playwright/test';
import {
  newBoardId,
  openBoard,
  closeAll,
  getNotes,
  getCamera,
  setCamera,
  notesKey,
  expectWithin,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  type Participant,
} from './participants';
import { seedNotes, getSelection, marquee, dragNoteWorld, type SeedNote } from './helpers/selection';

/**
 * Story 7 group transform e2e (TC-33 to TC-36). Chromium.
 *
 * Screen math: initial camera {x:-640, y:-360}; at zoom 1 screen = world +
 * (640, 360). Seeded stickies are 120x120 (TC-32 uses the 200x200 default).
 */
test.describe('Story 7 group transform e2e', () => {
  test.describe.configure({ timeout: 120_000 });

  /** The 2x3 grid used by TC-33 and TC-34 (120x120 stickies). */
  function gridIds(): { ids: string[]; layout: SeedNote[] } {
    const cols = [-240, 0];
    const rows = [-260, -80, 100];
    const ids: string[] = [];
    const layout: SeedNote[] = [];
    let z = 0;
    for (const y of rows) {
      for (const x of cols) {
        const id = crypto.randomUUID();
        ids.push(id);
        layout.push({ id, x, y, z: z++, size: 120 });
      }
    }
    return { ids, layout };
  }

  test('TC-33: 6 notes move together above a 4th; corner resize scales sizes and gaps; min clamp', async ({ browser }) => {
    const boardId = newBoardId();
    const p: Participant = await openBoard(browser, boardId);
    try {
      const { ids: g, layout } = gridIds();
      const fourth = crypto.randomUUID();
      layout.push({ id: fourth, x: 240, y: -40, z: 6, size: 120 });
      await seedNotes(p.page, layout);

      // Marquee the 2x3 grid: world (-250,-270) -> (130,230); the 4th note
      // (240..360, -40..80) is outside.
      await marquee(p.page, { x: 390, y: 90 }, { x: 770, y: 590 });
      await expect
        .poll(async () => getSelection(p.page), { timeout: 5000 })
        .toEqual(expect.arrayContaining(g));
      expect(await getSelection(p.page)).toHaveLength(6);
      await expect
        .poll(async () => p.page.locator('[data-testid="selection-count"]').textContent(), { timeout: 5000 })
        .toBe('6 selected');

      // --- Group move: drag g1 (center screen (460,160)) +300 world x. ---
      await dragNoteWorld(p.page, g[0], 300, 0, 120);
      let notes = await getNotes(p.page);
      for (const id of g) {
        const n = notes.find((s) => s.id === id)!;
        const orig = layout.find((s) => s.id === id)!;
        expect(n.x).toBeCloseTo(orig.x + 300, 1);
        expect(n.y).toBeCloseTo(orig.y, 1);
      }
      // The moved group is now above the 4th note; the 4th is untouched.
      const zFourth = notes.find((n) => n.id === fourth)!.z;
      for (const id of g) expect(notes.find((n) => n.id === id)!.z).toBeGreaterThan(zFourth);

      // Box is now world (60..420, -260..220) = screen (700,100)-(1060,580).
      // --- Grow from the SE handle (1060,580) by (100,100) screen. ---
      await p.page.mouse.move(1060, 580);
      await p.page.mouse.down();
      await p.page.mouse.move(1160, 680, { steps: 10 });
      await p.page.mouse.up();
      notes = await getNotes(p.page);
      // scale = max(460/360, 580/480) = 1.2778 -> 120 * scale = 153.33
      for (const id of g) {
        const n = notes.find((s) => s.id === id)!;
        expect(n.width).toBeCloseTo(153.333, 1);
        expect(n.height).toBeCloseTo(153.333, 1);
      }
      const g1 = notes.find((n) => n.id === g[0])!;
      const g2 = notes.find((n) => n.id === g[1])!;
      expect(g1.x).toBeCloseTo(60, 1);
      expect(g1.y).toBeCloseTo(-260, 1);
      // Gaps scale with the notes: g2.x - (g1.x + g1.width) = 120 * 1.2778.
      expect(g2.x - (g1.x + (g1.width as number))).toBeCloseTo(153.333, 1);

      // --- Shrink from the NW handle (700,100) far past the minimum. ---
      await p.page.mouse.move(700, 100);
      await p.page.mouse.down();
      await p.page.mouse.move(1100, 640, { steps: 10 });
      await p.page.mouse.up();
      notes = await getNotes(p.page);
      for (const id of g) {
        const n = notes.find((s) => s.id === id)!;
        expect(n.width).toBeCloseTo(50, 1); // STICKY_MIN_SIZE_WORLD
        expect(n.height).toBeCloseTo(50, 1);
      }
      // Anchor (SE corner) stayed fixed: final box (370..520, 153.33..353.33).
      expect(notes.find((n) => n.id === g[0])!.x).toBeCloseTo(370, 0);
      expect(notes.find((n) => n.id === g[0])!.y).toBeCloseTo(153.333, 0);
      // The 4th note was never touched by any gesture.
      const f = notes.find((n) => n.id === fourth)!;
      expect(f.x).toBe(240);
      expect(f.y).toBe(-40);
      expect(f.width).toBe(120);
    } finally {
      await closeAll(p);
    }
  });

  test('TC-34: arrows nudge the whole selection (no scroll/pan); Delete removes all', async ({ browser }) => {
    const boardId = newBoardId();
    const p: Participant = await openBoard(browser, boardId);
    try {
      const { ids: g, layout } = gridIds();
      await seedNotes(p.page, layout);
      await marquee(p.page, { x: 390, y: 90 }, { x: 770, y: 590 });
      await expect
        .poll(async () => getSelection(p.page), { timeout: 5000 })
        .toHaveLength(6);

      const camBefore = await getCamera(p.page);
      const scrollBefore = await p.page.evaluate(() => window.scrollY);

      // 3 x ArrowRight (+1 each) + Shift+ArrowRight (+10) = +13 world x.
      await p.page.keyboard.press('ArrowRight');
      await p.page.keyboard.press('ArrowRight');
      await p.page.keyboard.press('ArrowRight');
      await p.page.keyboard.down('Shift');
      await p.page.keyboard.press('ArrowRight');
      await p.page.keyboard.up('Shift');

      const notes = await getNotes(p.page);
      for (const id of g) {
        const n = notes.find((s) => s.id === id)!;
        const orig = layout.find((s) => s.id === id)!;
        expect(n.x).toBeCloseTo(orig.x + 13, 3);
        expect(n.y).toBeCloseTo(orig.y, 3);
      }
      // No page scroll and no board pan from the arrow keys.
      expect(await p.page.evaluate(() => window.scrollY)).toBe(scrollBefore);
      expect(await getCamera(p.page)).toEqual(camBefore);

      // Delete removes the whole selection.
      await p.page.keyboard.press('Delete');
      await expect
        .poll(async () => (await getNotes(p.page)).length, { timeout: 5000 })
        .toBe(0);
      await expect.poll(async () => getSelection(p.page), { timeout: 5000 }).toHaveLength(0);
    } finally {
      await closeAll(p);
    }
  });

  test('TC-35: Sam deletes one of Lee\'s selected notes -> Lee\'s selection prunes within budget', async ({ browser }) => {
    const boardId = newBoardId();
    const lee: Participant = await openBoard(browser, boardId);
    const sam: Participant = await openBoard(browser, boardId);
    try {
      // 5x4 grid of 120x120 stickies: cols -400..240 step 160, rows -320..160 step 160.
      const cols = [-400, -240, -80, 80, 240];
      const rows = [-320, -160, 0, 160];
      const layout: SeedNote[] = [];
      const at = (r: number, c: number): string => {
        const id = crypto.randomUUID();
        layout.push({ id, x: cols[c], y: rows[r], z: r * 5 + c, size: 120 });
        return id;
      };
      const ids: string[][] = rows.map((_, r) => cols.map((_, c) => at(r, c)));
      await seedNotes(lee.page, layout);
      await expect
        .poll(async () => (await getNotes(sam.page)).length, { timeout: 15000 })
        .toBe(20);

      // Lee marquee-selects the top-left 2x2: world (-410,-330) -> (-110,-30).
      await marquee(lee.page, { x: 230, y: 30 }, { x: 530, y: 330 });
      await expect
        .poll(async () => getSelection(lee.page), { timeout: 5000 })
        .toEqual(expect.arrayContaining([ids[0][0], ids[0][1], ids[1][0], ids[1][1]]));
      expect(await getSelection(lee.page)).toHaveLength(4);
      await expect
        .poll(async () => lee.page.locator('[data-testid="selection-count"]').textContent(), { timeout: 5000 })
        .toBe('4 selected');

      // Sam selects r1c1 (centre screen (460,260)) and deletes it.
      await sam.page.mouse.click(460, 260);
      await expect
        .poll(async () => getSelection(sam.page), { timeout: 5000 })
        .toEqual([ids[1][1]]);
      await sam.page.keyboard.press('Delete');
      const t0 = Date.now();

      // Within the live-update budget Lee sees the deletion and the pruned
      // selection ("3 selected").
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, 'Lee prunes within budget', async () => {
        const notes = await getNotes(lee.page);
        if (notes.length !== 19) return false;
        if (notes.some((n) => n.id === ids[1][1])) return false;
        const sel = await getSelection(lee.page);
        if (!sel.includes(ids[1][1])) {
          // selection must be exactly the other three of the 2x2
          const expected = [ids[0][0], ids[0][1], ids[1][0]].sort();
          if (sel.length !== 3 || !expected.every((id) => sel.includes(id))) return false;
        }
        const count = await lee.page.locator('[data-testid="selection-count"]').textContent();
        return count === '3 selected' && Date.now() - t0 <= LIVE_UPDATE_LATENCY_BUDGET_MS + 250;
      });

      // Lee deletes the remaining three.
      await lee.page.keyboard.press('Delete');
      await expect
        .poll(async () => (await getNotes(lee.page)).length, { timeout: 5000 })
        .toBe(16);
      await expect
        .poll(async () => (await getNotes(sam.page)).length, { timeout: 5000 })
        .toBe(16);
    } finally {
      await closeAll(lee, sam);
    }
  });

  test('TC-36: 5 editors move different selections simultaneously -> identical final positions', async ({ browser }) => {
    const boardId = newBoardId();
    const participants: Participant[] = [];
    try {
      // 5x5 grid of 120x120 stickies: cols step 320 from -500, rows step 290 from -320.
      const layout: SeedNote[] = [];
      const rowFirst: string[] = [];
      let z = 0;
      for (let k = 0; k < 5; k++) {
        for (let j = 0; j < 5; j++) {
          const id = crypto.randomUUID();
          if (j === 0) rowFirst.push(id);
          layout.push({ id, x: -500 + 320 * j, y: -320 + 290 * k, z: z++, size: 120 });
        }
      }
      for (let i = 0; i < 5; i++) participants.push(await openBoard(browser, boardId));
      await seedNotes(participants[0].page, layout);
      for (const p of participants) {
        await setCamera(p.page, { x: -640, y: -360, zoom: 0.5 });
        await expect
          .poll(async () => (await getNotes(p.page)).length, { timeout: 15000 })
          .toBe(25);
      }

      // Each editor selects its own row: click + 4 shift-clicks. At zoom 0.5
      // the row-k note j centre is screen (100 + 160j, 50 + 145k).
      await Promise.all(
        participants.map(async (p, k) => {
          const y = 50 + 145 * k;
          await p.page.mouse.click(100, y);
          for (let j = 1; j < 5; j++) {
            await p.page.keyboard.down('Shift');
            await p.page.mouse.click(100 + 160 * j, y);
            await p.page.keyboard.up('Shift');
          }
          const sel = await getSelection(p.page);
          expect(sel).toHaveLength(5);
        }),
      );

      // Simultaneous group moves: each editor drags its row +200 world x
      // (+100 screen px at zoom 0.5).
      const origins = layout.slice();
      await Promise.all(
        participants.map(async (p, k) => {
          await dragNoteWorld(p.page, rowFirst[k], 200, 0, 120);
        }),
      );

      // All 5 contexts converge on the same board state.
      await expect
        .poll(
          async () => {
            const vals = await Promise.all(
              participants.map(async (p) => notesKey(await getNotes(p.page))),
            );
            return new Set(vals).size === 1;
          },
          { timeout: 30_000, message: 'all 5 contexts converge on one snapshot' },
        )
        .toBe(true);

      // Final positions: each note moved exactly +200 world x, y unchanged.
      const notes = await getNotes(participants[0].page);
      expect(notes).toHaveLength(25);
      const bad: string[] = [];
      for (const o of origins) {
        const n = notes.find((s) => s.id === o.id)!;
        if (Math.abs(n.x - (o.x + 200)) > 0.05 || Math.abs(n.y - o.y) > 0.05) {
          bad.push(`${o.id.slice(0, 4)}:${o.x}->${n.x.toFixed(2)}`);
        }
      }
      expect(bad).toEqual([]);
    } finally {
      await closeAll(...participants);
    }
  });
});
