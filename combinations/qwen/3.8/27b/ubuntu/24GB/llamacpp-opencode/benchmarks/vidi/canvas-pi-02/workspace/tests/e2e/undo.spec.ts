import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  initDoc,
} from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';
import { getNotes, type NoteInfo } from './helpers/board';
import {
  createBoard,
  dragNote,
  expectNoteCountWithin,
  join,
  type Participant,
} from './helpers/participants';
import { mainRoomUrl, seedDoc } from './helpers/seed-board';

/**
 * Story 8 e2e (task 5, TC-22 to TC-24): per-user undo/redo through real
 * browsers over the real `wrangler dev` serving path.
 *
 * The shared e2e webServer runs on 8787, so boards are seeded through a real
 * WebSocket on that port (not the persist process). Camera: HOME_CAMERA
 * {-640, -400, 1}, so screen = world + (640, 400). A note centred at world
 * (x, y) has its top-left at (x-100, y-100) and a 200x200 footprint.
 *
 * Personal scope is what is under test: each participant's Ctrl/Cmd+Z runs
 * against their own controller (only their LOCAL_ORIGIN steps), so an undo
 * never reverses a colleague's change and never recreates an object a
 * colleague deleted.
 */

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Close every participant, whatever the outcome. */
async function closeAll(...ps: Participant[]): Promise<void> {
  for (const p of ps) await p.close();
}

/** Shift+drag a marquee rectangle (screen px) to box-select. */
async function boxSelect(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/**
 * The cluster/stray fixture (TC-22, TC-23): 8 notes in one box-selectable
 * cluster — a 4x2 grid 300 apart (so the 200x200 notes never overlap and a
 * single note can be dragged without touching its neighbours) — plus 4 strays
 * far to the right (world x >= 800), outside the cluster's marquee.
 *
 *  c1(-450,-150) c2(-150,-150) c3(150,-150) c4(450,-150)
 *  c5(-450, 150) c6(-150, 150) c7(150, 150) c8(450, 150)
 *
 * The cluster spans world x:[-550,550], y:[-250,250] → screen x:[90,1190],
 * y:[150,650]. A marquee from screen (80,140) to (1200,660) captures exactly
 * the 8 cluster notes; the strays (screen x >= 1440) are far outside.
 */
const CLUSTER_XS = [-450, -150, 150, 450];
const CLUSTER_YS = [-150, 150];
const STRAYS: Array<[number, number]> = [
  [800, -150], [1000, -150],
  [800, 150], [1000, 150],
];

function buildClusterDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  const cluster: Array<[number, number]> = [];
  for (const y of CLUSTER_YS) for (const x of CLUSTER_XS) cluster.push([x, y]);
  cluster.forEach(([x, y], i) => {
    getStickyText(doc, createSticky(doc, { x, y }, COLORS[i % COLORS.length]))!.insert(0, `cluster-${i + 1}`);
  });
  STRAYS.forEach(([x, y], i) => {
    getStickyText(doc, createSticky(doc, { x, y }, COLORS[(i + 3) % COLORS.length]))!.insert(0, `stray-${i + 1}`);
  });
  return doc;
}

/** Seed the cluster board on the shared e2e server. */
async function seedClusterBoard(request: APIRequestContext): Promise<string> {
  const id = await createBoard(request);
  await seedDoc(mainRoomUrl(id), buildClusterDoc(), 90_000, 'cluster board');
  // A margin for the room's append to be durable before the browsers load it.
  await sleep(1_000);
  return id;
}

/** The 10-note fixture for TC-24: a move row (y=-160) and a type row (y=160),
 *  five notes 240 apart in each. Note i is moved, note i+5 is typed into. */
function buildConcurrentDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  const xs = [-480, -240, 0, 240, 480];
  xs.forEach((x, i) => {
    getStickyText(doc, createSticky(doc, { x, y: -160 }, COLORS[i % COLORS.length]))!.insert(0, `move-${i}`);
  });
  xs.forEach((x, i) => {
    getStickyText(doc, createSticky(doc, { x, y: 160 }, COLORS[(i + 2) % COLORS.length]))!.insert(0, `type-${i + 5}`);
  });
  return doc;
}

/** world (x, y) centre → screen (x+640, y+400) at HOME_CAMERA. */
const sx = (wx: number): number => wx + 640;
const sy = (wy: number): number => wy + 400;

/** notes keyed by (their distinct) text → rounded position, for board equality. */
function boardState(notes: NoteInfo[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of notes) m.set(n.text, `${Math.round(n.x)},${Math.round(n.y)}`);
  return m;
}

function expectSameBoard(a: NoteInfo[], b: NoteInfo[]): void {
  const sa = boardState(a);
  const sb = boardState(b);
  expect([...sa.entries()].sort()).toEqual([...sb.entries()].sort());
}

test.describe('story 8 e2e: per-user undo/redo', () => {
  test('TC-22 recover an accidental delete while a colleague works', async ({ browser, request }) => {
    test.setTimeout(180_000);
    const id = await seedClusterBoard(request);
    const mia = await join(browser, id);
    const raj = await join(browser, id);
    try {
      await expectNoteCountWithin(mia, 12);
      await expectNoteCountWithin(raj, 12);

      // The cluster's screen bounds are x:[90,1190], y:[150,650]; a marquee a
      // little larger captures exactly the 8 cluster notes (the strays sit at
      // screen x >= 1440, far outside).
      await boxSelect(mia.page, 80, 140, 1200, 660);
      await mia.page.keyboard.press('Delete');
      await expectNoteCountWithin(mia, 4); // 8 cluster gone, 4 strays remain
      await expectNoteCountWithin(raj, 4);

      // Raj adds a note (a colleague's change).
      await raj.page.getByRole('button', { name: 'Sticky note' }).click();
      await raj.page.keyboard.press('Escape');
      await expectNoteCountWithin(mia, 5);
      await expectNoteCountWithin(raj, 5);

      // Mia undoes her delete: the 8 cluster notes return on BOTH screens,
      // Raj's note remains (personal scope — her undo never touches his change).
      await mia.page.keyboard.press('Control+z');
      await expectNoteCountWithin(mia, 13); // 4 strays + 8 cluster + Raj's
      await expectNoteCountWithin(raj, 13);

      // The restored cluster notes are intact (text + position), and Raj's
      // note is still there.
      const miaNotes = await getNotes(mia.page);
      for (let i = 1; i <= 8; i += 1) {
        expect(miaNotes.some((n) => n.text === `cluster-${i}`)).toBe(true);
      }
      const c1 = miaNotes.find((n) => n.text === 'cluster-1')!;
      // cluster-1 was centred at world (-450, -150) → top-left (-550, -250).
      expect([Math.round(c1.x), Math.round(c1.y)]).toEqual([-550, -250]);
      expect(miaNotes).toHaveLength(13);

      // Mia's own undo history is now exhausted → the Undo button is disabled.
      await expect(mia.page.getByRole('button', { name: 'Undo' })).toBeDisabled();

      // Mia clicks Redo: the 8 disappear again on both screens.
      await mia.page.getByRole('button', { name: 'Redo' }).click();
      await expectNoteCountWithin(mia, 5);
      await expectNoteCountWithin(raj, 5);

      expect(mia.pageErrors).toEqual([]);
      expect(raj.pageErrors).toEqual([]);
    } finally {
      await closeAll(mia, raj);
    }
  });

  test('TC-23 undo after a colleague deleted my object is a safe no-op', async ({ browser, request }) => {
    test.setTimeout(180_000);
    const id = await seedClusterBoard(request);
    const mia = await join(browser, id);
    const raj = await join(browser, id);
    try {
      await expectNoteCountWithin(mia, 12);
      await expectNoteCountWithin(raj, 12);

      // Mia moves cluster-1 (centred at world (-450, -150) → screen (190, 250)).
      // The move keeps it clear of its neighbours (300 apart, notes 200 wide).
      await dragNote(mia.page, sx(-450), sy(-150), 40, 20);
      await sleep(120);
      expect(Math.round((await getNotes(mia.page)).find((n) => n.text === 'cluster-1')!.x)).toBe(-550 + 40); // -510

      // Raj deletes that note. Its centre is now world (-410, -130) →
      // screen (230, 270).
      await raj.page.mouse.click(sx(-410), sy(-130));
      await expect(raj.page.getByRole('toolbar', { name: 'Note options' })).toBeVisible();
      await raj.page.getByRole('button', { name: 'Delete note' }).click();
      await expectNoteCountWithin(mia, 11); // deleted, synced to Mia
      await expectNoteCountWithin(raj, 11);

      // Mia undoes: the inverse targets a deleted note → no throw, the note is
      // NOT recreated, and it stays absent on both screens. The no-op step is
      // drained, so her undo history is now empty.
      await mia.page.keyboard.press('Control+z');
      await sleep(200);
      expect((await getNotes(mia.page)).some((n) => n.text === 'cluster-1')).toBe(false);
      expect((await getNotes(raj.page)).some((n) => n.text === 'cluster-1')).toBe(false);
      await expect(mia.page.getByRole('button', { name: 'Undo' })).toBeDisabled();

      // Mia's NEXT undo still works: a fresh change she makes is undoable, and
      // the controller was not corrupted by the no-op. Move cluster-2 (centred
      // at world (-150, -150) → screen (490, 250)), then undo it.
      await dragNote(mia.page, sx(-150), sy(-150), 40, 20);
      await sleep(120);
      expect(Math.round((await getNotes(mia.page)).find((n) => n.text === 'cluster-2')!.x)).toBe(-250 + 40); // -210
      await expect(mia.page.getByRole('button', { name: 'Undo' })).toBeEnabled();
      await mia.page.keyboard.press('Control+z');
      await sleep(200);
      // cluster-2 is back at its original top-left (-250, -250); cluster-1 is
      // still absent (the earlier no-op did not recreate it).
      expect(Math.round((await getNotes(mia.page)).find((n) => n.text === 'cluster-2')!.x)).toBe(-250);
      expect((await getNotes(mia.page)).some((n) => n.text === 'cluster-1')).toBe(false);
      expect((await getNotes(raj.page)).some((n) => n.text === 'cluster-1')).toBe(false);

      expect(mia.pageErrors).toEqual([]);
      expect(raj.pageErrors).toEqual([]);
    } finally {
      await closeAll(mia, raj);
    }
  });

  test('TC-24 everyone undoing at once reverts only their own changes', async ({ browser, request }) => {
    test.setTimeout(240_000);
    const id = await createBoard(request);
    await seedDoc(mainRoomUrl(id), buildConcurrentDoc(), 90_000, 'concurrent board');
    await sleep(1_000);

    const ps = await Promise.all(
      Array.from({ length: 5 }, () => join(browser, id)),
    );
    try {
      for (const p of ps) await expectNoteCountWithin(p, 10);

      // The seed board (what every replica must return to after the undos).
      const seedState = boardState(await getNotes(ps[0]!.page));

      // Each participant i moves note i (move row) and types into note i+5
      // (type row) — disjoint notes, so the five never contend for one object.
      await Promise.all(
        ps.map(async (p, i) => {
          const x = -480 + i * 240;
          // Move move-i, centred at world (x, -160).
          await dragNote(p.page, sx(x), sy(-160), 80, 40);
          // Type into type-(i+5), centred at world (x, 160).
          await p.page.mouse.dblclick(sx(x), sy(160));
          await p.page.getByRole('textbox', { name: 'Sticky note text' }).waitFor({ timeout: 5_000 });
          await p.page.keyboard.type(`edited-${i}`);
          await p.page.keyboard.press('Escape');
          // Let the local steps settle, then undo exactly her own two steps.
          await sleep(150);
          await p.page.keyboard.press('Control+z'); // undo the typing
          await sleep(80);
          await p.page.keyboard.press('Control+z'); // undo the move
        }),
      );

      // Every replica converges back to the seed board: each participant
      // reverted her own move + typing, and nobody reverted anyone else's.
      for (const p of ps) {
        await expect
          .poll(
            async () => {
              const notes = await getNotes(p.page);
              return boardState(notes).size === 10
                ? JSON.stringify([...boardState(notes).entries()].sort())
                : 'pending';
            },
            { timeout: 30_000, intervals: [100], message: 'replica should return to the seed board' },
          )
          .toBe(JSON.stringify([...seedState.entries()].sort()));
        expect(p.pageErrors).toEqual([]);
      }
    } finally {
      await closeAll(...ps);
    }
  });
});
