// Story 7 e2e: marquee selection, group move/resize on a real browser,
// keyboard nudging without scroll/pan, remote pruning and full-capacity
// simultaneous group moves (TC-32 to TC-36).

import { test, expect, type Page } from '@playwright/test';
import { gotoBoard, getCamera, setCamera, getNotes, type NoteInfo } from './helpers/board';
import { openParticipants } from './helpers/participants';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

type Sized = NoteInfo & { width?: number; height?: number };

function getSizedNotes(page: Page): Promise<Sized[]> {
  return page.evaluate(() =>
    (
      window as never as {
        __vidi6: { board: { getNotes(): Sized[] } };
      }
    ).__vidi6.board.getNotes(),
  );
}

async function dragFromTo(
  page: Page,
  from: [number, number],
  to: [number, number],
  shift = false,
): Promise<void> {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

// Creates a note centred on a screen point and leaves it unedited.
async function createNoteAt(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.dblclick(x, y);
  await expect(page.getByTestId('sticky-textarea')).toBeVisible();
  await page.keyboard.press('Escape');
}

async function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-testid="sticky-note"][data-selected="true"]'),
    ).map((n) => n.getAttribute('data-note-id')!),
  );
}

test('TC-32: marquee selects only fully enclosed notes', async ({ page }) => {
  await gotoBoard(page);
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
  // world == screen at this camera. A: 100..300, B: 380..580, C: 600..800.
  await createNoteAt(page, 200, 200); // A
  await createNoteAt(page, 480, 300); // B (half inside)
  await createNoteAt(page, 700, 700); // C (outside)
  const notes = await getSizedNotes(page);
  expect(notes).toHaveLength(3);
  await page.keyboard.press('Escape'); // drop the after-edit selection (additive marquee)

  // Marquee [50..550] x [50..550]: only A lies fully inside.
  await dragFromTo(page, [50, 50], [550, 550], true);

  // A single sticky selection shows the note toolbar, not the counter.
  const a = notes.find((n) => n.x < 150)!;
  await expect.poll(() => selectedIds(page)).toEqual([a.id]);
});

test('TC-33: marquee, group move past an unselected note, then corner resize', async ({ page }) => {
  await gotoBoard(page);
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
  // Cluster of four (centres 200/450) and one note outside the cluster.
  await createNoteAt(page, 200, 200);
  await createNoteAt(page, 450, 200);
  await createNoteAt(page, 200, 450);
  await createNoteAt(page, 450, 450);
  await createNoteAt(page, 900, 300); // the "4th other note", never selected
  const notes = await getSizedNotes(page);
  expect(notes).toHaveLength(5);
  const outside = notes.find((n) => n.x >= 800)!;
  const cluster = notes.filter((n) => n.id !== outside.id);
  await page.keyboard.press('Escape'); // drop the after-edit selection (additive marquee)

  // Select the cluster: marquee 50..560 contains all four (100..550).
  await dragFromTo(page, [50, 50], [560, 560], true);
  await expect(page.getByText('4 selected')).toBeVisible();

  // Move the whole selection 300 units right, above the outside note.
  await dragFromTo(page, [200, 200], [500, 200]);
  await expect
    .poll(async () => {
      const now = await getSizedNotes(page);
      return cluster.every((n) => {
        const m = now.find((x) => x.id === n.id)!;
        return Math.abs(m.x - (n.x + 300)) < 1 && Math.abs(m.y - n.y) < 1;
      });
    })
    .toBe(true);
  let now = await getSizedNotes(page);
  expect(now.find((n) => n.id === outside.id)!.x).toBe(outside.x);

  // The selection is still the cluster; grab the southeast handle and grow
  // the bounding box by 100 px on both axes (zoom 1 -> 100 world units).
  await expect(page.getByText('4 selected')).toBeVisible();
  const handle = await page.getByTestId('handle-se').boundingBox();
  expect(handle).not.toBeNull();
  const hx = handle!.x + handle!.width / 2;
  const hy = handle!.y + handle!.height / 2;
  await dragFromTo(page, [hx, hy], [hx + 100, hy + 100]);

  now = await getSizedNotes(page);
  // Box was 100..550 in x and y after the move -> 450 wide; scale = 550/450.
  const scale = 550 / 450;
  for (const n of cluster) {
    const m = now.find((x) => x.id === n.id)!;
    expect(m.width, `note ${m.id} resized`).toBeCloseTo(200 * scale, 0);
    expect(m.height).toBeCloseTo(200 * scale, 0);
    // Notes stay square and positions scale from the anchored box origin.
    expect(m.width).toBeCloseTo(m.height!, 0);
  }
  // The unselected note keeps its implicit square size untouched.
  const mo = now.find((n) => n.id === outside.id)!;
  expect(mo.width).toBeUndefined();
});

test('TC-34: arrows nudge the selection without page scroll or board pan; Delete removes all', async ({
  page,
}) => {
  await gotoBoard(page);
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
  await createNoteAt(page, 200, 200);
  await createNoteAt(page, 450, 250);
  const before = await getSizedNotes(page);
  await page.keyboard.press('Escape'); // drop the after-edit selection (additive marquee)

  await dragFromTo(page, [80, 60], [580, 400], true); // select both
  await expect(page.getByText('2 selected')).toBeVisible();

  const cameraBefore = await getCamera(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect
    .poll(async () => {
      const now = await getSizedNotes(page);
      return before.every((n) => {
        const m = now.find((x) => x.id === n.id)!;
        return m.x === n.x + 2 && m.y === n.y + 10;
      });
    })
    .toBe(true);

  // No pan, no page scroll (negative).
  expect(await getCamera(page)).toEqual(cameraBefore);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page.keyboard.press('Delete');
  await expect.poll(() => getSizedNotes(page)).toEqual([]);
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
});

test('TC-35: remote delete of one selected note drops it from my selection', async ({
  browser,
}) => {
  const [lee, sam] = await openParticipants(browser, ['lee', 'sam']);
  await setCamera(lee.page, { x: 0, y: 0, zoom: 1 });
  await createNoteAt(lee.page, 200, 200);
  await createNoteAt(lee.page, 450, 250);

  await dragFromTo(lee.page, [80, 60], [580, 400], true);
  await expect(lee.page.getByText('2 selected')).toBeVisible();

  // Sam deletes one of Lee's selected notes through the note toolbar.
  const shared = await getNotes(sam.page);
  const victim = shared[0];
  await sam.page.locator(`[data-note-id="${victim.id}"]`).click();
  await sam.page.getByTestId('delete-note').click();

  await expect
    .poll(() => selectedIds(lee.page), { timeout: 10_000 })
    .toEqual([shared[1].id]);
});

test('TC-36: every editor moves a different group at once and all screens converge', async ({
  browser,
}) => {
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `p${i}`);
  const participants = await openParticipants(browser, names);
  const page0 = participants[0].page;

  // A row of six notes at zoom 0.7 so all fit the viewport. The camera is
  // local view state, so every page needs it set.
  const cam = { x: -100, y: -100, zoom: 0.7 };
  for (const p of participants) await setCamera(p.page, cam);
  const centres = [200, 450, 700, 950, 1200, 1450];
  for (const cx of centres) {
    await createNoteAt(page0, (cx + 100) * 0.7, (400 + 100) * 0.7);
  }
  for (const p of participants) {
    await expect
      .poll(() => getNotes(p.page), { timeout: 15_000 })
      .toHaveLength(6);
  }
  const notes = await getSizedNotes(page0);
  expect(notes).toHaveLength(6);
  await page0.keyboard.press('Escape'); // drop the after-edit selection (additive marquee)

  // Three disjoint selections (pairs) moved by three participants at once.
  const plans = [
    { pair: [0, 1], dx: 30 },
    { pair: [2, 3], dx: -30 },
    { pair: [4, 5], dx: 45 },
  ];
  const worldToScreenX = (w: number) => (w + 100) * 0.7;

  await Promise.all(
    plans.map(async ({ pair, dx }) => {
      const p = participants[pair[0] === 0 ? 0 : pair[0] === 2 ? 1 : 2];
      const c0 = centres[pair[0]];
      const c1 = centres[pair[1]];
      const left = c0 - 110;
      const right = c1 + 110;
      // Stories 10-12 grew the left toolbar (Shape/Connector/Image buttons)
      // so it now spans roughly y 224..576; the marquee starts below it and
      // drags up above its top edge.
      await dragFromTo(p.page, [worldToScreenX(left), 610], [worldToScreenX(right), 190], true);
      await expect
        .poll(() => selectedIds(p.page), { message: `marquee for pair ${pair}` })
        .toHaveLength(2);
      const anchor = c0;
      await dragFromTo(p.page, [worldToScreenX(anchor), 350], [worldToScreenX(anchor) + dx * 0.7, 350]);
    }),
  );

  const expected = new Map<string, number>();
  for (const { pair, dx } of plans) {
    for (const idx of pair) {
      const n = [...notes].sort((a, b) => a.x - b.x)[idx];
      expected.set(n.id, n.x + dx);
    }
  }

  for (const p of participants) {
    await expect
      .poll(
        async () => {
          const now = await getSizedNotes(p.page);
          return now.every((n) => {
            const want = expected.get(n.id);
            return want === undefined || Math.abs(n.x - want) < 2;
          });
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  }
  // All screens agree exactly on the final positions.
  const finals = await Promise.all(
    participants.map(async (p) => {
      const now = await getSizedNotes(p.page);
      return [...now].sort((a, b) => a.id.localeCompare(b.id)).map((n) => `${n.id}:${n.x}`).join('|');
    }),
  );
  expect(new Set(finals).size).toBe(1);
});
