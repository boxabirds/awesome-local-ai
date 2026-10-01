import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS, NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { boardWithNotes, selectionRetroBoard, type GeneratedBoard } from '../fixtures/boards';
import { nextFrames, setCamera } from './helpers/board';
import { createBoardId, E2E_ORIGIN } from './helpers/create';
import { notesOf, openParticipants } from './helpers/participants';
import { seedBoard } from './helpers/seed';

async function newSeededBoard(board: GeneratedBoard, count: number): Promise<string> {
  const id = await createBoardId();
  await seedBoard(E2E_ORIGIN, id, board.updates, count);
  return id;
}

async function openBoard(page: Page, id: string, zoom = 1): Promise<void> {
  await page.goto(`/b/${id}`);
  await expect.poll(() => page.evaluate(() => window.__vidi6?.connectionState), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe('connected');
  await setCamera(page, 0, 0, zoom);
}

/** The note whose top-left is exactly this world position (only valid for notes never resized or nudged). */
const noteAt = (page: Page, x: number, y: number): Locator =>
  page.locator(`[data-sticky-note][style*="left: ${x}px;"][style*="top: ${y}px;"]`);

interface NoteBox { x: number; y: number; w: number; h: number; z: number }
const readNotes = (page: Page): Promise<NoteBox[]> => page.locator('[data-sticky-note]').evaluateAll((els) => els.map((el) => {
  const s = (el as HTMLElement).style;
  return { x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height), z: parseInt(s.zIndex, 10) };
}));
const near = (notes: NoteBox[], x: number, y: number): NoteBox => {
  const n = notes.find((c) => Math.abs(c.x - x) < 0.01 && Math.abs(c.y - y) < 0.01);
  if (!n) throw new Error(`no note at ${x},${y}`);
  return n;
};

async function shiftDrag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(...to, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await nextFrames(page);
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
  await nextFrames(page);
}

const selectedNotes = (page: Page): Locator => page.locator('[data-sticky-note][data-selected="true"]');
const center = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const cameraOf = (page: Page) => page.getByTestId('board-world').evaluate((el) => (el as HTMLElement).style.transform);

test('TC-32 Shift+drag selects only the note fully inside the rectangle', async ({ page }) => {
  const board = boardWithNotes([{ x: 100, y: 100, text: 'A' }, { x: 400, y: 100, text: 'B' }, { x: 900, y: 500, text: 'C' }]);
  await openBoard(page, await newSeededBoard(board, 3));
  await shiftDrag(page, [50, 50], [500, 350]);
  await expect(selectedNotes(page)).toHaveCount(1);
  await expect(selectedNotes(page)).toContainText('A');
  await expect(page.getByTestId('selection-box')).toBeVisible();
});

test.describe('Reorganise a cluster', () => {
  // Each test changes the board, so each gets a fresh copy of the fixture.
  async function selectCluster(page: Page) {
    await openBoard(page, await newSeededBoard(selectionRetroBoard(), 20));
    await shiftDrag(page, [50, 50], [900, 640]);
    await expect(selectedNotes(page)).toHaveCount(6);
    await expect(page.getByRole('toolbar', { name: 'Selection' })).toContainText('6 selected');
  }

  test('TC-33 move 300 units above another note, resize proportionally, shrink to the minimum', async ({ page }) => {
    await selectCluster(page);
    const loneZ = near(await readNotes(page), 1000, 100).z;
    await drag(page, await center(noteAt(page, 100, 100)), 300, 0);
    let notes = await readNotes(page);
    for (const [x, y] of [[100, 100], [360, 100], [620, 100], [100, 360], [360, 360], [620, 360]]) {
      expect(near(notes, x + 300, y).z).toBeGreaterThan(loneZ);
    }
    await expect(selectedNotes(page)).toHaveCount(6);

    // bottom-right handle: +20% in both directions about the top-left of the bounding box (400,100)
    await drag(page, await center(page.getByRole('button', { name: 'Resize bottom-right' })), 144, 92);
    notes = await readNotes(page);
    const a = near(notes, 400, 100);
    expect(a.w).toBeCloseTo(240, 6);
    expect(a.h).toBeCloseTo(a.w, 6);
    const b = near(notes, 400 + 260 * 1.2, 100);
    expect(b.x - (a.x + a.w)).toBeCloseTo(72, 6); // the 60-unit gap grew by 20%

    // shrink far past the minimum: stops at STICKY_MIN_SIZE_WORLD
    await drag(page, await center(page.getByRole('button', { name: 'Resize bottom-right' })), -2000, -2000);
    const small = near(await readNotes(page), 400, 100);
    expect(small.w).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(small.h).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
  });

  test('TC-34 arrows nudge without scrolling or panning; Delete removes the selection', async ({ page }) => {
    await selectCluster(page);
    const camera = await cameraOf(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const dx = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
    expect(near(await readNotes(page), 100 + dx, 100).x).toBe(100 + dx);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await cameraOf(page)).toBe(camera);
    await page.keyboard.press('Delete');
    await expect(notesOf(page)).toHaveCount(14);
    await expect(page.getByRole('toolbar', { name: 'Selection' })).toHaveCount(0);
  });
});

test('TC-35 a colleague deletes one of my selected notes: it drops out of my selection', async ({ browser }) => {
  const id = await newSeededBoard(selectionRetroBoard(), 20);
  const [lee, sam] = await openParticipants(browser, 2, id);
  await shiftDrag(lee.page, [50, 50], [600, 600]);
  await expect(selectedNotes(lee.page)).toHaveCount(4);
  await expect(lee.page.getByRole('toolbar', { name: 'Selection' })).toContainText('4 selected');

  await noteAt(sam.page, 100, 100).click();
  await sam.page.keyboard.press('Delete');
  await expect(lee.page.getByRole('toolbar', { name: 'Selection' })).toContainText('3 selected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(selectedNotes(lee.page)).toHaveCount(3);
  await expect(notesOf(lee.page)).toHaveCount(19);

  await lee.page.keyboard.press('Delete');
  await expect(notesOf(lee.page)).toHaveCount(16);
  await expect(notesOf(sam.page)).toHaveCount(16, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await lee.context.close();
  await sam.context.close();
});

test(`TC-36 ${MAX_CONCURRENT_EDITORS} people move different selections at once and every screen agrees`, async ({ browser }) => {
  const rows = MAX_CONCURRENT_EDITORS;
  const layout = [];
  for (let r = 0; r < rows; r++) for (const x of [100, 400]) layout.push({ x, y: 100 + r * 300, text: `Row ${r + 1}` });
  const id = await newSeededBoard(boardWithNotes(layout), layout.length);
  const people = await openParticipants(browser, rows, id);
  for (const p of people) await setCamera(p.page, 0, 0, 0.5);

  // Each person boxes in their own row (half-scale screen coordinates) and drags it by a different amount.
  await Promise.all(people.map(async ({ page }, r) => {
    await shiftDrag(page, [25, 25 + r * 150], [350, 175 + r * 150]);
    await expect(selectedNotes(page)).toHaveCount(2);
    const first = (await page.locator(`[data-sticky-note][style*="top: ${100 + r * 300}px"]`).first().boundingBox())!;
    await drag(page, { x: first.x + 20, y: first.y + 20 }, 40 * (r + 1), 0);
  }));

  const read = (page: Page) => page.locator('[data-sticky-note]').evaluateAll((els) => els
    .map((el) => [parseFloat((el as HTMLElement).style.left), parseFloat((el as HTMLElement).style.top)])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]));
  const expected = layout
    .map((n, i) => [n.x + 80 * (Math.floor(i / 2) + 1), n.y])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const p of people) {
    await expect.poll(() => read(p.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toEqual(expected);
  }
  for (const p of people) await p.context.close();
});
