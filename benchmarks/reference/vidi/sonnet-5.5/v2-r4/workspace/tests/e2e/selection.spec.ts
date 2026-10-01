import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import {
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { groupsBoard, selectionBoard20 } from '../fixtures/selection-boards';
import { setCamera, originCentre } from './helpers/board';
import { closeAll, expectEventually, noteViews, openParticipants } from './helpers/participants';
import { seedBoard } from './helpers/seed';

const notes = (page: Page) => page.getByRole('group', { name: 'Sticky note' });
const noteWith = (page: Page, text: string) => notes(page).filter({ hasText: new RegExp(`^${text}$`) });
const selectedCount = (page: Page) => page.locator('[data-note-id][data-selected="true"]').count();
const bar = (page: Page) => page.getByRole('status').filter({ hasText: /selected$/ });

interface WorldRect { x: number; y: number; width: number; height: number; z: number }

async function rectOf(page: Page, text: string): Promise<WorldRect> {
  return noteWith(page, text).evaluate((el) => {
    const s = (el as HTMLElement).style;
    return { x: parseFloat(s.left), y: parseFloat(s.top), width: parseFloat(s.width), height: parseFloat(s.height), z: Number(el.getAttribute('data-z')) };
  });
}

/** World (0,0) is at the centre of the 1280x800 viewport at any zoom set here. */
async function viewAt(page: Page, zoom: number) {
  await setCamera(page, -640 / zoom, -400 / zoom, zoom);
  return (wx: number, wy: number) => ({ x: 640 + wx * zoom, y: 400 + wy * zoom });
}

async function shiftDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

async function openSelectionBoard(browser: Parameters<typeof openParticipants>[0], n: number) {
  const boardId = newBoardId();
  const opened = await seedAndOpen(browser, n, boardId, selectionBoard20());
  await Promise.all(opened.people.map((p) => expect(notes(p.page)).toHaveCount(20)));
  return opened;
}

async function seedAndOpen(browser: Parameters<typeof openParticipants>[0], n: number, boardId: string, doc: import('yjs').Doc) {
  await seedBoard('http://localhost:8791', boardId, doc);
  return openParticipants(browser, n, boardId);
}

test.describe('Reorganise a cluster', () => {
  test('TC-32 Shift+drag selects only the notes fully inside the rectangle', async ({ browser }) => {
    const { people } = await openSelectionBoard(browser, 1);
    const { page } = people[0];
    await expect(notes(page)).toHaveCount(20);
    const at = await viewAt(page, 1);
    // S1 (x -550..-350... ) is fully inside; S2 is half inside; S4 and S5 lie below the rectangle.
    await shiftDrag(page, at(-570, -270), at(-190, -30));
    await expect(bar(page)).toHaveCount(0); // a single note: the note toolbar, not the bar
    await expect(selectedCount(page)).resolves.toBe(1);
    await expect(noteWith(page, 'S1')).toHaveAttribute('data-selected', 'true');
    await expect(noteWith(page, 'S2')).toHaveAttribute('data-selected', 'false');
    await expect(noteWith(page, 'S4')).toHaveAttribute('data-selected', 'false');
    expect(people[0].consoleErrors).toEqual([]);
    await closeAll(people);
  });

  test('TC-33 / TC-34 select 6, move together, resize, nudge without scrolling, delete', async ({ browser }) => {
    const { people } = await openSelectionBoard(browser, 1);
    const { page } = people[0];
    const zoom = 0.5;
    const at = await viewAt(page, zoom);

    // marquee around S1..S6 (not S7)
    await shiftDrag(page, at(-580, -280), at(200, 240));
    await expect(bar(page)).toHaveText('6 selected');
    await expect(page.getByRole('button', { name: 'Delete selection' })).toBeVisible();
    for (const h of ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left']) {
      await expect(page.getByRole('button', { name: `Resize ${h}`, exact: true })).toBeVisible();
    }

    // Shift-click S7 adds it, Shift-click again removes it
    await page.keyboard.down('Shift');
    await noteWith(page, 'S7').click();
    await expect(bar(page)).toHaveText('7 selected');
    await noteWith(page, 'S7').click();
    await page.keyboard.up('Shift');
    await expect(bar(page)).toHaveText('6 selected');

    // group move by 300 world units, over S7
    const s7 = await rectOf(page, 'S7');
    const before = await Promise.all(['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].map((t) => rectOf(page, t)));
    const s1 = at(-450, -150);
    await drag(page, s1, { x: s1.x + 300 * zoom, y: s1.y });
    const moved = await Promise.all(['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].map((t) => rectOf(page, t)));
    moved.forEach((m, i) => {
      expect(m.x).toBeCloseTo(before[i].x + 300, 0);
      expect(m.y).toBeCloseTo(before[i].y, 0);
      expect(m.z).toBeGreaterThan(s7.z);
    });
    await expect(bar(page)).toHaveText('6 selected');
    const centre = await originCentre(page);

    // resize from the bottom-right corner: scale 1.5 about the top-left (notes stay square)
    const box = (await page.getByTestId('selection-box').boundingBox())!;
    const corner = { x: box.x + box.width, y: box.y + box.height };
    await drag(page, corner, { x: corner.x + (box.width / 2) * 1, y: corner.y });
    const grown = await Promise.all(['S1', 'S2', 'S4'].map((t) => rectOf(page, t)));
    expect(grown[0].width).toBeCloseTo(300, 0);
    expect(grown[0].height).toBeCloseTo(300, 0);
    expect(grown[1].x - (grown[0].x + grown[0].width)).toBeCloseTo(90, 0); // gap 60 -> 90
    expect(grown[2].y - (grown[0].y + grown[0].height)).toBeCloseTo(90 - 0, 0);
    expect(grown[0].x).toBeCloseTo(moved[0].x, 0); // top-left stays put

    // shrinking stops at the minimum size
    const box2 = (await page.getByTestId('selection-box').boundingBox())!;
    const c2 = { x: box2.x + box2.width, y: box2.y + box2.height };
    await drag(page, c2, { x: box2.x + 3, y: box2.y + 3 });
    const small = await rectOf(page, 'S1');
    expect(small.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 0);
    expect(small.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 0);

    // nudge: no page scroll, no pan
    const p0 = await rectOf(page, 'S1');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => (await rectOf(page, 'S1')).x).toBeCloseTo(p0.x + 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD, 0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await originCentre(page)).toEqual(centre);

    // delete everything selected
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(14);
    await expect(bar(page)).toHaveCount(0);
    expect(people[0].consoleErrors).toEqual([]);
    await closeAll(people);
  });
});

test.describe('Colleague deletes while I select', () => {
  test('TC-35 a note deleted by Sam leaves Lee’s selection', async ({ browser }) => {
    const { people } = await openSelectionBoard(browser, 2);
    const [lee, sam] = people;
    await Promise.all(people.map(async (p) => {
      await expect(notes(p.page)).toHaveCount(20);
      await viewAt(p.page, 1);
    }));
    const at = (wx: number, wy: number) => ({ x: 640 + wx, y: 400 + wy });
    await shiftDrag(lee.page, at(-570, -270), at(-50, 230)); // S1, S2, S4, S5
    await expect(bar(lee.page)).toHaveText('4 selected');

    await noteWith(sam.page, 'S1').click();
    await sam.page.keyboard.press('Delete');
    await expectEventually('note disappears for Lee', () => noteWith(lee.page, 'S1').count(), 0);
    await expect(bar(lee.page)).toHaveText('3 selected');
    await expect(selectedCount(lee.page)).resolves.toBe(3);

    await lee.page.keyboard.press('Delete');
    await expect(notes(lee.page)).toHaveCount(16);
    await expect(notes(sam.page)).toHaveCount(16);
    for (const t of ['S3', 'S6', 'S7']) await expect(noteWith(lee.page, t)).toHaveCount(1);
    await closeAll(people);
  });
});

test.describe('Full-capacity reorganisation', () => {
  test('TC-36 five people move different selections at once and converge', async ({ browser }) => {
    const n = MAX_CONCURRENT_EDITORS;
    const boardId = newBoardId();
    const { people } = await seedAndOpen(browser, n, boardId, groupsBoard(n, 2));
    await Promise.all(people.map(async (p) => {
      await expect(notes(p.page)).toHaveCount(n * 2);
      await viewAt(p.page, 0.5);
    }));
    const start = await noteViews(people[0].page);

    await Promise.all(
      people.map(async (p, k) => {
        const at = (wx: number, wy: number) => ({ x: 640 + wx * 0.5, y: 400 + wy * 0.5 });
        const gx = k * 480 - 1000;
        await shiftDrag(p.page, at(gx - 30, -230), at(gx + 460, 30));
        await expect(bar(p.page)).toHaveText('2 selected');
        const from = at(gx + 100, -100);
        await drag(p.page, from, { x: from.x + 40, y: from.y + 60 * (k + 1) });
      }),
    );

    await expect
      .poll(async () => {
        const views = await Promise.all(people.map((p) => noteViews(p.page)));
        return views.every((v) => JSON.stringify(v) === JSON.stringify(views[0]));
      }, { timeout: 15_000 })
      .toBe(true);
    const end = await noteViews(people[0].page);
    expect(end).toHaveLength(start.length);
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < 2; i++) {
        const text = `G${k}-${i}`;
        const r = await rectOf(people[0].page, text);
        expect(r.y).toBeCloseTo(-200 + 120 * (k + 1), -1);
      }
    }
    people.forEach((p) => expect(p.consoleErrors).toEqual([]));
    await closeAll(people);
  });
});
