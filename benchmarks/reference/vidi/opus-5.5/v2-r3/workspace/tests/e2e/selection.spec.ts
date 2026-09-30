// Story 7 — select, move, resize, nudge and delete several objects at once.
// Boards are seeded with the 20-note selection fixture, and the camera is set to
// a known view so world units map to exact screen pixels.
import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { selectionBoard } from '../fixtures/boards';
import { getCamera, setCamera, viewport } from './helpers/board';
import { noteIdAt } from './helpers/notes';
import { closeAll, expectSameBoards, openParticipants, recordLatency, type Participant } from './helpers/participants';
import { seedBoard } from './helpers/seed';
import { createBoardId } from './helpers/server';

const CAMERA = { x: -100, y: -100, zoom: 0.5 };

interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

let participants: Participant[] = [];
test.afterEach(async () => {
  await closeAll(participants);
  participants = [];
});

/** Seeds a new board with the selection fixture; returns its id and note ids. */
async function seededBoard(baseURL: string) {
  const boardId = await createBoardId(baseURL);
  const fixture = selectionBoard();
  await seedBoard(baseURL, boardId, fixture.doc);
  return { boardId, a: fixture.a, b: fixture.b };
}

async function openSeeded(page: Page, boardId: string, noteCount: number): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(() => window.__vidi6 !== undefined);
  await expect(page.getByRole('group', { name: 'Sticky note' })).toHaveCount(noteCount, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await setCamera(page, CAMERA);
}

/** Viewport pixel of a world point (whole pixels, so deltas are exact). */
async function toScreen(page: Page, p: { x: number; y: number }) {
  const box = (await viewport(page).boundingBox())!;
  return {
    x: Math.round(box.x + (p.x - CAMERA.x) * CAMERA.zoom),
    y: Math.round(box.y + (p.y - CAMERA.y) * CAMERA.zoom),
  };
}

async function rects(page: Page): Promise<Record<string, WorldRect>> {
  return page.evaluate(() => {
    const out: Record<string, { x: number; y: number; width: number; height: number; z: number }> = {};
    window.__vidi6!.doc.getMap('objects').forEach((value, id) => {
      const m = value as unknown as { get(k: string): unknown };
      out[id] = {
        x: m.get('x') as number,
        y: m.get('y') as number,
        width: (m.get('width') as number | undefined) ?? 200,
        height: (m.get('height') as number | undefined) ?? 200,
        z: m.get('z') as number,
      };
    });
    return out;
  });
}

async function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-object-id][data-selected="true"]'))
      .map((el) => el.dataset.objectId!)
      .sort(),
  );
}

async function marquee(page: Page, fromWorld: { x: number; y: number }, toWorld: { x: number; y: number }) {
  const from = await toScreen(page, fromWorld);
  const to = await toScreen(page, toWorld);
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await expect(page.getByTestId('marquee')).toBeVisible();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('marquee')).toHaveCount(0);
}

async function dragPx(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 6 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
}

async function handleCentre(page: Page, name: string) {
  const box = (await page.getByRole('button', { name }).boundingBox())!;
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

function selectionBar(page: Page) {
  return page.getByRole('toolbar', { name: 'Selection' });
}

test.describe('Reorganise a cluster', () => {
  test('TC-32: Shift+drag selects only the note fully inside (A), not B (half inside) or C (outside)', async ({
    page,
    baseURL,
  }) => {
    const { boardId, a } = await seededBoard(baseURL!);
    await openSeeded(page, boardId, 20);
    const cam = await getCamera(page);
    // A = a[0][0] (0..200), B = a[0][1] (250..450, half inside), C = a[1][0] (below).
    await marquee(page, { x: -20, y: -20 }, { x: 350, y: 220 });
    expect(await selectedIds(page)).toEqual([a[0][0]]);
    await expect(page.getByRole('toolbar', { name: 'Note' })).toBeVisible(); // one sticky → note toolbar
    expect(await getCamera(page)).toEqual(cam); // Shift+drag never pans
  });

  test('TC-33 + TC-34: box-select 6, move together above a 4th, resize, nudge and delete', async ({ page, baseURL }) => {
    const { boardId, a } = await seededBoard(baseURL!);
    await openSeeded(page, boardId, 20);
    const six = [a[0][0], a[0][1], a[0][2], a[1][0], a[1][1], a[1][2]];
    const fourth = a[0][3];

    // Select 6 with a box.
    await marquee(page, { x: -20, y: -20 }, { x: 720, y: 470 });
    expect(await selectedIds(page)).toEqual([...six].sort());
    await expect(selectionBar(page)).toContainText('6 selected');
    await expect(page.getByRole('button', { name: /^Resize / })).toHaveCount(8);

    // TC-33: drag one of them 300 world units right (150 px at 50%).
    const start = await rects(page);
    const zOrder = (r: Record<string, WorldRect>) => [...six].sort((p, q) => r[p].z - r[q].z);
    await dragPx(page, await toScreen(page, { x: 100, y: 100 }), 150, 0);
    let after = await rects(page);
    for (const id of six) {
      expect(after[id].x).toBe(start[id].x + 300);
      expect(after[id].y).toBe(start[id].y);
    }
    expect(zOrder(after)).toEqual(zOrder(start)); // stacking among themselves kept
    for (const id of six) expect(after[id].z).toBeGreaterThan(after[fourth].z);
    // a[0][2] (now 800..1000) covers the 4th note (750..950) where they overlap.
    expect(await noteIdAt(page, await toScreen(page, { x: 900, y: 100 }))).toBe(a[0][2]);
    expect(await selectedIds(page)).toEqual([...six].sort()); // still selected after the move

    // Resize from the bottom-right handle: box 700 wide → +700 world (350 px) = ×2 from the top-left.
    const box0 = { x: 300, y: 0 };
    await dragPx(page, await handleCentre(page, 'Resize bottom-right'), 350, 0);
    const grown = await rects(page);
    for (const id of six) {
      expect(grown[id].width).toBeCloseTo(400, 6);
      expect(grown[id].height).toBeCloseTo(400, 6); // notes stay square
      expect(grown[id].x).toBeCloseTo(box0.x + (after[id].x - box0.x) * 2, 6);
      expect(grown[id].y).toBeCloseTo(box0.y + (after[id].y - box0.y) * 2, 6);
    }
    expect(grown[a[0][1]].x - (grown[a[0][0]].x + grown[a[0][0]].width)).toBeCloseTo(100, 6); // gaps scale too

    // Shrinking far stops at STICKY_MIN_SIZE_WORLD for every note, layout kept.
    await dragPx(page, await handleCentre(page, 'Resize bottom-right'), -690, -440);
    const shrunk = await rects(page);
    for (const id of six) {
      expect(shrunk[id].width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
      expect(shrunk[id].height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    }
    expect(shrunk[a[0][1]].x - shrunk[a[0][0]].x).toBeCloseTo((grown[a[0][1]].x - grown[a[0][0]].x) / 8, 6);

    // TC-34: nudge with arrows — no page scroll, no pan.
    const cam = await getCamera(page);
    after = await rects(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const nudged = await rects(page);
    for (const id of six) {
      expect(nudged[id].x).toBeCloseTo(after[id].x + 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD, 6);
      expect(nudged[id].y).toBe(after[id].y);
    }
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
    expect(await getCamera(page)).toEqual(cam);

    // Delete removes all 6.
    await page.keyboard.press('Delete');
    await expect(page.getByRole('group', { name: 'Sticky note' })).toHaveCount(14);
    const left = await rects(page);
    for (const id of six) expect(left[id]).toBeUndefined();
    expect(left[fourth]).toBeDefined();
    await expect(selectionBar(page)).toHaveCount(0);
  });

  test('Ctrl/Cmd+A selects every note; Escape clears', async ({ page, baseURL }) => {
    const { boardId } = await seededBoard(baseURL!);
    await openSeeded(page, boardId, 20);
    await viewport(page).click({ position: { x: 900, y: 700 } });
    await page.keyboard.press('ControlOrMeta+a');
    await expect(selectionBar(page)).toContainText('20 selected');
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    await page.keyboard.press('Escape');
    await expect(selectionBar(page)).toHaveCount(0);
    expect(await selectedIds(page)).toEqual([]);
  });
});

test('TC-35: a colleague deletes one of my selected notes → it leaves my selection', async ({ browser, baseURL }) => {
  const { boardId, a } = await seededBoard(baseURL!);
  participants = await openParticipants(browser, ['Lee', 'Sam'], boardId);
  const [lee, sam] = participants.map((p) => p.page);
  for (const p of [lee, sam]) {
    await expect(p.getByRole('group', { name: 'Sticky note' })).toHaveCount(20, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await setCamera(p, CAMERA);
  }
  const four = [a[0][0], a[0][1], a[1][0], a[1][1]];
  await marquee(lee, { x: -20, y: -20 }, { x: 470, y: 470 });
  await expect(selectionBar(lee)).toContainText('4 selected');

  // Sam selects one of those notes and deletes it.
  const target = a[0][0];
  const onTarget = await toScreen(sam, { x: 100, y: 100 });
  await sam.mouse.click(onTarget.x, onTarget.y);
  expect(await selectedIds(sam)).toEqual([target]);
  const sentAt = Date.now();
  await sam.keyboard.press('Delete');

  await expect(lee.locator(`[data-note-id="${target}"]`)).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  recordLatency('remote delete prunes selection', Date.now() - sentAt);
  await expect(selectionBar(lee)).toContainText('3 selected');
  expect(await selectedIds(lee)).toEqual(four.filter((id) => id !== target).sort());

  await lee.keyboard.press('Delete');
  await expect(lee.getByRole('group', { name: 'Sticky note' })).toHaveCount(16);
  const remaining = await rects(lee);
  for (const id of four) expect(remaining[id]).toBeUndefined();
  await expect(sam.getByRole('group', { name: 'Sticky note' })).toHaveCount(16, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
});

test('TC-36: MAX_CONCURRENT_EDITORS people move different selections at once → identical final positions', async ({
  browser,
  baseURL,
}) => {
  const { boardId, a } = await seededBoard(baseURL!);
  const names = ['Lee', 'Sam', 'Alex', 'Kim', 'Noor'].slice(0, MAX_CONCURRENT_EDITORS);
  participants = await openParticipants(browser, names, boardId);
  const pages = participants.map((p) => p.page);
  for (const p of pages) {
    await expect(p.getByRole('group', { name: 'Sticky note' })).toHaveCount(20, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await setCamera(p, CAMERA);
  }
  const flat = a.flat();
  const pairs = pages.map((_, i) => [flat[2 * i], flat[2 * i + 1]]);
  const start = await rects(pages[0]);
  const centreOf = (id: string) => ({ x: start[id].x + 100, y: start[id].y + 100 });

  // Everyone selects their own pair (click + Shift-click).
  for (const [i, page] of pages.entries()) {
    const [first, second] = pairs[i];
    const p1 = await toScreen(page, centreOf(first));
    const p2 = await toScreen(page, centreOf(second));
    await page.mouse.click(p1.x, p1.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(p2.x, p2.y);
    await page.keyboard.up('Shift');
    expect(await selectedIds(page)).toEqual([first, second].sort());
  }

  // Everyone presses first (so no one grabs a note someone else already moved), then drags at once.
  const deltas = pages.map((_, i) => ({ x: 60 * (i + 1), y: 600 })); // world units
  const downs = await Promise.all(pages.map((page, i) => toScreen(page, centreOf(pairs[i][0]))));
  await Promise.all(pages.map((page, i) => page.mouse.move(downs[i].x, downs[i].y).then(() => page.mouse.down())));
  await Promise.all(
    pages.map(async (page, i) => {
      const d = { x: deltas[i].x * CAMERA.zoom, y: deltas[i].y * CAMERA.zoom };
      await page.mouse.move(downs[i].x + d.x / 2, downs[i].y + d.y / 2, { steps: 8 });
      await page.mouse.move(downs[i].x + d.x, downs[i].y + d.y, { steps: 8 });
      await page.mouse.up();
    }),
  );

  const expected = new Map<string, { x: number; y: number }>();
  pairs.forEach((pair, i) => {
    for (const id of pair) expected.set(id, { x: start[id].x + deltas[i].x, y: start[id].y + deltas[i].y });
  });
  const board = await expectSameBoards(participants);
  for (const note of board) {
    const want = expected.get(note.id) ?? { x: start[note.id].x, y: start[note.id].y };
    expect({ id: note.id, x: note.x, y: note.y }).toEqual({ id: note.id, ...want });
  }
  // Documents agree too (including stacking).
  const docs = await Promise.all(pages.map((p) => rects(p)));
  for (const d of docs) expect(d).toEqual(docs[0]);
});
