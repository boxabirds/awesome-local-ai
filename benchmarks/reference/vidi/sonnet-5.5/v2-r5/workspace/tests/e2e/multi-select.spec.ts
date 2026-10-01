import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS, NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD, STICKY_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { build20NoteBoard, buildGridBoard } from '../fixtures/boards';
import { getCamera, settled } from './helpers/board';
import { createBoardVia } from './helpers/create';
import { boardSnapshot, drag, expectEventually, notesOf, openParticipants } from './helpers/participants';
import { seedBoard } from './helpers/seed';

const EVENTUALLY = { timeout: E2E_EVENTUAL_TIMEOUT_MS };
// 1280x800 viewport, camera starts with the world origin in the centre: screen = world + (640, 400).
const screenOf = (wx: number, wy: number) => ({ x: wx + 640, y: wy + 400 });

const selected = (page: Page) => page.locator('[data-sticky][data-selected="true"]');

interface NoteInfo { id: string; x: number; y: number; width: number; height: number; z: number }
async function infos(page: Page): Promise<NoteInfo[]> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-sticky]')].map((e) => ({
    id: e.dataset.id!, x: Number(e.dataset.x), y: Number(e.dataset.y),
    width: Number(e.dataset.width), height: Number(e.dataset.height), z: Number(e.style.zIndex),
  })));
}
const byId = (all: NoteInfo[], id: string) => all.find((n) => n.id === id)!;
const note = (page: Page, id: string) => page.locator(`[data-sticky][data-id="${id}"]`);

async function marquee(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await expect(page.getByTestId('marquee')).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

async function openSeeded(page: Page, request: Parameters<typeof createBoardVia>[0], baseURL: string, rows = 'cluster') {
  const id = await createBoardVia(request);
  await seedBoard(baseURL, id, (doc) => { if (rows === 'cluster') build20NoteBoard(doc); else buildGridBoard(5, 2, doc); });
  await page.goto(`/b/${id}`);
  await expect(notesOf(page)).toHaveCount(rows === 'cluster' ? 20 : 10, EVENTUALLY);
  await settled(page);
  return id;
}

test.describe('workflow: reorganise a cluster', () => {
  test('TC-32 marquee selects only the fully enclosed note', async ({ page, request, baseURL }) => {
    await openSeeded(page, request, baseURL!);
    const all = await infos(page);
    const topLeft = all.find((n) => n.x === -600 && n.y === -350)!;
    // rectangle ends at world (-250, -140): A0 (-600..-400) fully inside, A1 (-350..-150) half, rest outside
    await marquee(page, screenOf(-630, -390), screenOf(-250, -140));
    await expect(selected(page)).toHaveCount(1);
    await expect(note(page, topLeft.id)).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('marquee')).toHaveCount(0);
  });

  test('TC-33 + TC-34 move, resize, nudge and delete six notes together', async ({ page, request, baseURL }) => {
    await openSeeded(page, request, baseURL!);
    await marquee(page, screenOf(-630, -390), screenOf(150, 150));
    await expect(selected(page)).toHaveCount(6);
    await expect(page.getByText('6 selected')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete selection' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Resize / })).toHaveCount(8);

    // group move by 300 world units, over the notes of cluster B
    const before = await infos(page);
    const ids = await selected(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-id')!));
    const grab = before.find((n) => n.x === -600 && n.y === -350)!;
    await drag(page, screenOf(grab.x + 100, grab.y + 100), 300, 0);
    await settled(page);
    const moved = await infos(page);
    for (const id of ids) {
      expect(byId(moved, id).x).toBeCloseTo(byId(before, id).x + 300, 0);
      expect(byId(moved, id).y).toBeCloseTo(byId(before, id).y, 0);
    }
    const others = moved.filter((n) => !ids.includes(n.id));
    expect(Math.min(...ids.map((id) => byId(moved, id).z))).toBeGreaterThan(Math.max(...others.map((n) => n.z)));
    await expect(selected(page)).toHaveCount(6);

    // resize from the bottom-right corner: sizes and gaps scale together, notes stay square
    const preResize = await infos(page);
    const corner = await page.getByRole('button', { name: 'Resize bottom-right' }).boundingBox();
    await drag(page, { x: corner!.x + corner!.width / 2, y: corner!.y + corner!.height / 2 }, 200, 20);
    await settled(page);
    const resized = await infos(page);
    const w = byId(resized, ids[0]).width;
    expect(w).toBeGreaterThan(200);
    const scale = w / 200;
    const a = ids.map((id) => byId(preResize, id));
    const origin = { x: Math.min(...a.map((n) => n.x)), y: Math.min(...a.map((n) => n.y)) };
    for (const id of ids) {
      const n = byId(resized, id);
      const p = byId(preResize, id);
      expect(n.width).toBeCloseTo(w, 1);
      expect(n.height).toBeCloseTo(w, 1);
      expect(n.x).toBeCloseTo(origin.x + (p.x - origin.x) * scale, 0);
      expect(n.y).toBeCloseTo(origin.y + (p.y - origin.y) * scale, 0);
    }

    // shrinking stops at the minimum size for the whole selection
    const handle = await page.getByRole('button', { name: 'Resize bottom-right' }).boundingBox();
    const hx = handle!.x + handle!.width / 2;
    const hy = handle!.y + handle!.height / 2;
    await drag(page, { x: hx, y: hy }, -1100, -700);
    await settled(page);
    const shrunk = await infos(page);
    for (const id of ids) expect(byId(shrunk, id).width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 0);

    // nudging with the arrow keys: no page scroll, no pan
    const cameraBefore = await getCamera(page);
    const pre = await infos(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await settled(page);
    const post = await infos(page);
    for (const id of ids) {
      expect(byId(post, id).x).toBeCloseTo(byId(pre, id).x + 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD, 3);
    }
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await getCamera(page)).toEqual(cameraBefore);

    // Delete removes the whole selection
    await page.keyboard.press('Delete');
    await expect(notesOf(page)).toHaveCount(14);
    await expect(page.getByText(/selected/)).toHaveCount(0);
  });
});

test('TC-35 a colleague deletes one of my selected notes', async ({ browser, request, baseURL }) => {
  const boardId = await createBoardVia(request);
  await seedBoard(baseURL!, boardId, (doc) => { build20NoteBoard(doc); });
  const [lee, sam] = await openParticipants(browser, ['Lee', 'Sam'], boardId);
  await expect(notesOf(lee.page)).toHaveCount(20, EVENTUALLY);
  await expect(notesOf(sam.page)).toHaveCount(20, EVENTUALLY);

  await marquee(lee.page, screenOf(-630, -390), screenOf(-130, 130));
  await expect(lee.page.getByText('4 selected')).toBeVisible();
  const ids = await selected(lee.page).evaluateAll((els) => els.map((e) => e.getAttribute('data-id')!));
  expect(ids).toHaveLength(4);

  await note(sam.page, ids[0]).click();
  await sam.page.keyboard.press('Delete');
  await expect(note(lee.page, ids[0])).toHaveCount(0, EVENTUALLY);
  await expect(lee.page.getByText('3 selected')).toBeVisible(EVENTUALLY);
  await expect(selected(lee.page)).toHaveCount(3);

  await lee.page.keyboard.press('Delete');
  await expect(notesOf(lee.page)).toHaveCount(16, EVENTUALLY);
  await expect(notesOf(sam.page)).toHaveCount(16, EVENTUALLY);
  for (const id of ids.slice(1)) await expect(note(sam.page, id)).toHaveCount(0);
  await Promise.all([lee.context.close(), sam.context.close()]);
});

test('TC-36 full-capacity reorganisation converges on every screen', async ({ browser, request, baseURL }) => {
  const boardId = await createBoardVia(request);
  await seedBoard(baseURL!, boardId, (doc) => { buildGridBoard(MAX_CONCURRENT_EDITORS, 2, doc); });
  const people = await openParticipants(browser, ['p1', 'p2', 'p3', 'p4', 'p5'].slice(0, MAX_CONCURRENT_EDITORS), boardId);
  for (const p of people) await expect(notesOf(p.page)).toHaveCount(MAX_CONCURRENT_EDITORS * 2, EVENTUALLY);

  const start = await infos(people[0].page);
  const columns = [...new Set(start.map((n) => n.x))].sort((a, b) => a - b);
  const expected = new Map<string, { x: number; y: number }>();

  await Promise.all(people.map(async (p, i) => {
    const mine = start.filter((n) => n.x === columns[i]).sort((a, b) => a.y - b.y);
    await note(p.page, mine[0].id).click();
    await note(p.page, mine[1].id).click({ modifiers: ['Shift'] });
    await expect(selected(p.page)).toHaveCount(2);
    const dx = (i - 2) * 40;
    const dy = 60;
    for (const n of mine) expected.set(n.id, { x: n.x + dx, y: n.y + dy });
    await drag(p.page, screenOf(mine[0].x + 100, mine[0].y + 100), dx, dy);
  }));

  for (const p of people) {
    await expectEventually(`converge ${p.name}`, async () => {
      const now = await infos(p.page);
      return now.every((n) => {
        const e = expected.get(n.id);
        return e ? Math.abs(n.x - e.x) < 0.5 && Math.abs(n.y - e.y) < 0.5 : true;
      });
    }, true);
  }
  const reference = await boardSnapshot(people[0].page);
  for (const p of people.slice(1)) await expectEventually(`identical ${p.name}`, () => boardSnapshot(p.page), reference);
  for (const p of people) expect(p.errors).toEqual([]);
  await Promise.all(people.map((p) => p.context.close()));
});
