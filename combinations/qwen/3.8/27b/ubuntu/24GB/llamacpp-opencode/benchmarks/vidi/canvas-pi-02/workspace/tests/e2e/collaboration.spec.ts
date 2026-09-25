import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CATCH_UP_TEST_OUTAGE_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { getNotes, setCamera } from './helpers/board';
import {
  createNoteAt,
  dragNote,
  expectConnected,
  expectNoteCountWithin,
  expectWithin,
  freshBoardId,
  join,
  type Participant,
} from './helpers/participants';

/**
 * Story 3 e2e: live collaboration through real browsers over the real
 * `wrangler dev` serving path (task 8, TC-22 to TC-28).
 *
 * Two or more isolated contexts share one `/b/<boardId>`. Camera math with
 * HOME_CAMERA (world (0,0) at the 640,400 viewport centre, zoom 1):
 * screen = world - (-640, -400). A note created at the centre has its
 * top-left at world (-100, -100).
 */

const TA = (page: Page) => page.getByRole('textbox', { name: 'Sticky note text' });

/**
 * The connection badge specifically. The page has other `role=status` nodes
 * (the zoom `<output>` and the hint), so target the badge by its class.
 */
const badge = (page: Page) => page.locator('.vidi6-badge');

/** Close every participant, whatever the outcome. */
async function closeAll(...ps: Participant[]): Promise<void> {
  for (const p of ps) await p.close();
}

test.describe('sync.two-person workshop', () => {
  test('TC-22 Alex creates, moves, recolours, types, deletes → each visible to Sam within budget', async ({
    browser,
  }) => {
    const boardId = freshBoardId();
    const alex = await join(browser, boardId);
    const sam = await join(browser, boardId);
    try {
      // create
      await alex.page.getByRole('button', { name: 'Sticky note' }).click();
      await expectNoteCountWithin(sam, 1);
      await alex.page.keyboard.press('Escape');

      // move: drag (+80, +40) → top-left (-100, -100) → (-20, -60)
      await dragNote(alex.page, 640, 400, 80, 40);
      await expectWithin(
        async () => {
          const n = (await getNotes(sam.page))[0];
          return `${Math.round(n.x)},${Math.round(n.y)}`;
        },
        '-20,-60',
      );

      // recolour (select at the new centre, then the blue swatch)
      await alex.page.mouse.click(720, 440);
      await expect(alex.page.getByRole('toolbar', { name: 'Note options' })).toBeVisible();
      await alex.page.getByRole('button', { name: 'Blue colour' }).click();
      await expectWithin(() => getNotes(sam.page).then((n) => n[0].color), 'blue');

      // type
      await alex.page.mouse.dblclick(720, 440);
      await expect(TA(alex.page)).toBeVisible();
      await alex.page.keyboard.type('hi');
      await expectWithin(() => getNotes(sam.page).then((n) => n[0].text), 'hi');
      await alex.page.keyboard.press('Escape');

      // delete
      await alex.page.mouse.click(720, 440);
      await alex.page.getByRole('button', { name: 'Delete note' }).click();
      await expectNoteCountWithin(sam, 0);

      expect(alex.pageErrors).toEqual([]);
      expect(sam.pageErrors).toEqual([]);
    } finally {
      await closeAll(alex, sam);
    }
  });

  test('TC-23 both type simultaneously into one note → identical text with every typed character', async ({
    browser,
  }) => {
    const boardId = freshBoardId();
    const alex = await join(browser, boardId);
    const sam = await join(browser, boardId);
    try {
      // Seed note: Alex creates and types the PRD's base text 'green'.
      await alex.page.getByRole('button', { name: 'Sticky note' }).click();
      await alex.page.keyboard.type('green');
      await expectNoteCountWithin(sam, 1);
      // The concurrent phase below anchors each side's cursor to its local
      // copy of the seed text, so both replicas must hold the COMPLETE text
      // first: if Sam still only has 'gre', his Ctrl+End lands inside the
      // word and the merge is 'red gre blueen', not 'red green blue'.
      for (const p of [alex, sam]) {
        await expect
          .poll(async () => (await getNotes(p.page))[0]?.text ?? '', {
            timeout: 5000,
            intervals: [50],
          })
          .toBe('green');
      }
      await alex.page.keyboard.press('Escape');

      // Both enter edit mode on the same note. Non-overlapping concurrent
      // typing (live.concurrent_text): Alex prepends, Sam appends — the two
      // edits touch disjoint ranges, so every typed character must survive.
      await alex.page.mouse.dblclick(640, 400);
      await sam.page.mouse.dblclick(640, 400);
      await alex.page.keyboard.press('Control+Home');
      await sam.page.keyboard.press('Control+End');

      await Promise.all([
        alex.page.keyboard.type('red '),
        sam.page.keyboard.type(' blue'),
      ]);

      // Converge: every replica shows the fully merged text, identical.
      await expect
        .poll(
          async () => {
            const a = (await getNotes(alex.page))[0]?.text ?? '';
            const s = (await getNotes(sam.page))[0]?.text ?? '';
            return a === s ? a : '';
          },
          { timeout: 5000, intervals: [50] },
        )
        .toBe('red green blue');

      expect(alex.pageErrors).toEqual([]);
      expect(sam.pageErrors).toEqual([]);
    } finally {
      await closeAll(alex, sam);
    }
  });
});

// The remaining workshop/capacity cases are specified for chromium
// (task 8 "Done when": all pass in chromium, firefox/webkit for TC-22/23).
test.describe('sync.two-person workshop (chromium)', () => {
  test('TC-24 both drag the same note at once → identical settled position within budget', async ({
    browser,
    browserName,
  }) => {
    if (browserName !== 'chromium') return;
    const boardId = freshBoardId();
    const alex = await join(browser, boardId);
    const sam = await join(browser, boardId);
    try {
      await alex.page.getByRole('button', { name: 'Sticky note' }).click();
      await expectNoteCountWithin(sam, 1);
      await alex.page.keyboard.press('Escape');

      // Both grab the note centre and drag at the same time (different deltas: +40 vs +80 world-x).
      await Promise.all([
        dragNote(alex.page, 640, 400, 40, 0),
        dragNote(sam.page, 640, 400, 80, 0),
      ]);

      // Settle: both replicas agree on one position, within the budget
      // (live.converge: concurrent x/y sets resolve to one winner everywhere).
      await expectWithin(
        async () => {
          const a = (await getNotes(alex.page))[0];
          const s = (await getNotes(sam.page))[0];
          return a.x === s.x && a.y === s.y;
        },
        true,
      );
      // …and the winner is a plausible settled drag position. Both drags move
      // the note only right (deltas +40 / +80) from its start at world x = -100,
      // and the drag writes intermediate positions on every animation frame, so
      // the LWW winner is whichever client's last write won — any value in
      // [-100, -20]. y is unchanged (both dragged dy = 0).
      const a = (await getNotes(alex.page))[0];
      expect(a.x).toBeGreaterThanOrEqual(-100);
      expect(a.x).toBeLessThanOrEqual(-20);
      expect(a.y).toBeCloseTo(-100, 5);
    } finally {
      await closeAll(alex, sam);
    }
  });

  test('TC-25 Sam editing, Alex deletes → Sam’s note and editor disappear, no console errors', async ({
    browser,
    browserName,
  }) => {
    if (browserName !== 'chromium') return;
    const boardId = freshBoardId();
    const alex = await join(browser, boardId);
    const sam = await join(browser, boardId);
    try {
      await alex.page.getByRole('button', { name: 'Sticky note' }).click();
      await alex.page.keyboard.press('Escape');
      await expectNoteCountWithin(sam, 1);

      // Sam enters edit mode on the note and types.
      await sam.page.mouse.dblclick(640, 400);
      await expect(TA(sam.page)).toBeVisible();
      await sam.page.keyboard.type('keep');

      // Alex selects the note and deletes it.
      await alex.page.mouse.click(640, 400);
      await alex.page.getByRole('button', { name: 'Delete note' }).click();

      // Sam's note and editor disappear, within the budget.
      await expectNoteCountWithin(sam, 0);
      await expectWithin(() => TA(sam.page).count(), 0);
      expect(sam.pageErrors).toEqual([]);
      expect(alex.pageErrors).toEqual([]);
    } finally {
      await closeAll(alex, sam);
    }
  });

  test('TC-28 Alex selects and edits a note → Sam sees no selection outline or editor', async ({
    browser,
    browserName,
  }) => {
    if (browserName !== 'chromium') return;
    const boardId = freshBoardId();
    const alex = await join(browser, boardId);
    const sam = await join(browser, boardId);
    try {
      await alex.page.getByRole('button', { name: 'Sticky note' }).click();
      await alex.page.keyboard.press('Escape');
      await expectNoteCountWithin(sam, 1);

      // Alex selects: the outline appears on Alex's note only.
      await alex.page.mouse.click(640, 400);
      await expect(alex.page.locator('.vidi6-sticky.vidi6-sticky--selected')).toHaveCount(1);
      await expect(sam.page.locator('.vidi6-sticky--selected')).toHaveCount(0);

      // Alex edits: the editor appears on Alex only.
      await alex.page.mouse.dblclick(640, 400);
      await expect(TA(alex.page)).toBeVisible();
      await expect(TA(sam.page)).toHaveCount(0);
    } finally {
      await closeAll(alex, sam);
    }
  });
});

test.describe('sync.full-capacity session (chromium)', () => {
  test('TC-26 five editors each create 5 and move 5 notes → every change seen by all others; final DOM identical', async ({
    browser,
    browserName,
  }) => {
    if (browserName !== 'chromium') return;
    test.slow();
    const boardId = freshBoardId();
    const N = MAX_CONCURRENT_EDITORS;
    const participants: Participant[] = await Promise.all(
      Array.from({ length: N }, () => join(browser, boardId)),
    );
    try {
      // Same zoomed-out camera on every page: all 25 notes fit and never
      // overlap (125px screen spacing > 100px note size at zoom 0.5).
      const CAM = { x: -640, y: -400, zoom: 0.5 };
      for (const p of participants) await setCamera(p.page, CAM);

      // Note k of participant i: world centre (-250 + k*250, -250 + i*250),
      // i.e. screen (195 + k*125, 75 + i*125) with CAM.
      const screen = (i: number, k: number) => ({ x: 195 + k * 125, y: 75 + i * 125 });

      for (let i = 0; i < N; i++) {
        const p = participants[i];

        // Create five notes; every other editor sees the new count within budget.
        for (let k = 0; k < 5; k++) {
          const at = screen(i, k);
          await p.page.mouse.dblclick(at.x, at.y);
          await p.page.keyboard.press('Escape');
          const expected = i * 5 + k + 1;
          for (const q of participants) {
            if (q === p) continue;
            await expectWithin(() => getNotes(q.page).then((n) => n.length), expected);
          }
        }

        // Move each of my five by (+60, +60) world (30 screen px at zoom 0.5);
        // every other editor sees the new position within budget. Notes are
        // identified by id (their old position is gone once they move).
        const base = (k: number) => ({ x: -250 + k * 250 - 100, y: -250 + i * 250 - 100 });
        for (let k = 0; k < 5; k++) {
          const at = screen(i, k);
          const b = base(k);
          const mine = (await getNotes(p.page)).find(
            (n) => Math.abs(n.x - b.x) < 1 && Math.abs(n.y - b.y) < 1,
          )!;
          await dragNote(p.page, at.x, at.y, 30, 30);
          const target = `${b.x + 60},${b.y + 60}`;
          for (const q of participants) {
            if (q === p) continue;
            await expectWithin(
              async () => {
                const n = (await getNotes(q.page)).find((n) => n.id === mine.id);
                return n ? `${Math.round(n.x)},${Math.round(n.y)}` : 'missing';
              },
              target,
            );
          }
        }
      }

      // Final DOM snapshots: rendered note geometry is identical on every page.
      const domSnaps: string[] = [];
      for (const p of participants) {
        const snap = await p.page
          .locator('.vidi6-sticky')
          .evaluateAll((els) =>
            els
              .map((el) => {
                const r = el.getBoundingClientRect();
                return `${el.getAttribute('data-note-id')}:${Math.round(r.x)},${Math.round(
                  r.y,
                )},${Math.round(r.width)},${Math.round(r.height)}`;
              })
              .sort(),
          );
        domSnaps.push(JSON.stringify(snap));
      }
      for (let i = 1; i < domSnaps.length; i++) {
        expect(domSnaps[i], `page ${i} DOM differs from page 0`).toBe(domSnaps[0]);
      }
      for (const p of participants) expect(p.pageErrors).toEqual([]);
    } finally {
      await closeAll(...participants);
    }
  });
});

test.describe('sync.flaky Wi-Fi (chromium)', () => {
  test('TC-27 Alex offline for CATCH_UP_TEST_OUTAGE_MS; both add 3 notes; catch-up restores 6', async ({
    browser,
    browserName,
  }) => {
    if (browserName !== 'chromium') return;
    test.setTimeout(150_000);
    const boardId = freshBoardId();
    const alex = await join(browser, boardId);
    const sam = await join(browser, boardId);
    try {
      const outageStart = Date.now();

      await alex.context.setOffline(true);

      // Alex's socket drops: the badge shows "Reconnecting…".
      await expect(badge(alex.page)).toHaveText('Reconnecting…', { timeout: 10_000 });

      // Sam adds 3 notes (online).
      for (let i = 0; i < 3; i++) {
        await sam.page.mouse.dblclick(300 + i * 150, 250);
        await sam.page.keyboard.type(`sam${i}`);
        await sam.page.keyboard.press('Escape');
      }

      // Alex adds 3 notes (offline — local only for now).
      for (let i = 0; i < 3; i++) {
        await alex.page.mouse.dblclick(300 + i * 150, 550);
        await alex.page.keyboard.type(`alex${i}`);
        await alex.page.keyboard.press('Escape');
      }

      // Hold the outage at CATCH_UP_TEST_OUTAGE_MS total.
      const remaining = CATCH_UP_TEST_OUTAGE_MS - (Date.now() - outageStart);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));

      await alex.context.setOffline(false);

      // Alex reconnects: badge "Connected" (green)…
      await expect(badge(alex.page)).toHaveText('Connected', { timeout: 25_000 });
      // …then settles hidden (the confirmation window elapses).
      await expect(badge(alex.page)).toHaveCount(0, { timeout: 10_000 });
      // Still mapped `connected` afterwards.
      await expectConnected(alex.page);

      // Catch-up: both boards converge to the same 6 notes.
      await expectNoteCountWithin(alex, 6);
      await expectNoteCountWithin(sam, 6);
      await expect
        .poll(
          async () => {
            const a = (await getNotes(alex.page))
              .map((n) => `${Math.round(n.x)},${Math.round(n.y)}:${n.text}`)
              .sort();
            const s = (await getNotes(sam.page))
              .map((n) => `${Math.round(n.x)},${Math.round(n.y)}:${n.text}`)
              .sort();
            return JSON.stringify(a) === JSON.stringify(s);
          },
          { timeout: 10_000, intervals: [100] },
        )
        .toBe(true);

      expect(alex.pageErrors).toEqual([]);
      expect(sam.pageErrors).toEqual([]);
    } finally {
      await closeAll(alex, sam);
    }
  });
});
