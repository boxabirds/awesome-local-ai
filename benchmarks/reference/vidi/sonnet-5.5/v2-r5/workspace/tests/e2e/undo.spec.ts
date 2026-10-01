import { expect, test, type Page } from '@playwright/test';
import type * as Y from 'yjs';
import { createSticky, getStickyText, initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS, STICKY_COLORS, type StickyColor } from '../../src/shared/config';
import { settled } from './helpers/board';
import { createBoardVia } from './helpers/create';
import { boardSnapshot, drag, notesOf, openParticipants } from './helpers/participants';
import { seedBoard } from './helpers/seed';

const EVENTUALLY = { timeout: E2E_EVENTUAL_TIMEOUT_MS };
// 1280x800 viewport, camera starts with the world origin in the centre: screen = world + (640, 400).
const screenOf = (wx: number, wy: number) => ({ x: wx + 640, y: wy + 400 });
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

function addNote(doc: Y.Doc, cx: number, cy: number, color: StickyColor, text: string): void {
  const id = createSticky(doc, { x: cx, y: cy }, color) as string;
  doc.transact(() => getStickyText(doc, id)!.insert(0, text), LOCAL_ORIGIN);
}

/** Retro board: an 8-note cluster (4x2, varied colours and text) at the top left and 4 notes lower down. */
function buildRetro(doc: Y.Doc): void {
  initDoc(doc);
  for (let i = 0; i < 8; i++) {
    addNote(doc, -500 + (i % 4) * 210, -250 + Math.floor(i / 4) * 210, COLORS[i % COLORS.length], `cluster ${i}`);
  }
  for (let i = 0; i < 4; i++) addNote(doc, -500 + i * 210, 250, COLORS[(i + 3) % COLORS.length], `other ${i}`);
}

/** Five rows... two rows of MAX_CONCURRENT_EDITORS notes: movers on the lower row, typists on the upper row. */
function buildTwoRows(doc: Y.Doc): void {
  initDoc(doc);
  for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) addNote(doc, -500 + i * 250, -200, COLORS[i % COLORS.length], '');
  for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) addNote(doc, -500 + i * 250, 100, COLORS[(i + 1) % COLORS.length], `mover ${i}`);
}

async function seeded(request: Parameters<typeof createBoardVia>[0], baseURL: string, build: (doc: Y.Doc) => void) {
  const id = await createBoardVia(request);
  await seedBoard(baseURL, id, build);
  return id;
}

async function marquee(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

const undoBtn = (p: Page) => p.getByRole('button', { name: 'Undo' });
const redoBtn = (p: Page) => p.getByRole('button', { name: 'Redo' });

test.describe('workflow: recover my mistakes while colleagues work', () => {
  test('TC-22 undo an accidental delete of 8 notes; the colleague\'s note stays; redo and undo again', async ({ browser, request, baseURL }) => {
    const id = await seeded(request, baseURL!, buildRetro);
    const [mia, raj] = await openParticipants(browser, ['Mia', 'Raj'], id);
    await expect(notesOf(mia.page)).toHaveCount(12, EVENTUALLY);
    await expect(undoBtn(mia.page)).toBeDisabled();
    await expect(redoBtn(mia.page)).toBeDisabled();
    const before = await boardSnapshot(mia.page);

    await marquee(mia.page, screenOf(-630, -390), screenOf(300, 100));
    await expect(mia.page.getByText('8 selected')).toBeVisible();
    await mia.page.keyboard.press('Delete');
    await expect(notesOf(mia.page)).toHaveCount(4);
    await expect(notesOf(raj.page)).toHaveCount(4, EVENTUALLY);

    await raj.page.mouse.dblclick(screenOf(500, -100).x, screenOf(500, -100).y);
    await raj.page.keyboard.type('Raj was here');
    await raj.page.keyboard.press('Escape');
    await expect(notesOf(mia.page)).toHaveCount(5, EVENTUALLY);

    await expect(undoBtn(mia.page)).toBeEnabled();
    await mia.page.keyboard.press(`${MOD}+z`);
    for (const p of [mia.page, raj.page]) {
      await expect(notesOf(p)).toHaveCount(13, EVENTUALLY);
      await expect(p.getByText('Raj was here')).toHaveCount(1);
    }
    const restored = (await boardSnapshot(mia.page)).filter((s) => !s.endsWith('Raj was here'));
    expect(restored).toEqual(before);
    expect(await boardSnapshot(raj.page)).toEqual(await boardSnapshot(mia.page));

    await redoBtn(mia.page).click();
    for (const p of [mia.page, raj.page]) {
      await expect(notesOf(p)).toHaveCount(5, EVENTUALLY);
      await expect(p.getByText('Raj was here')).toHaveCount(1);
    }

    await undoBtn(mia.page).click();
    await expect(notesOf(raj.page)).toHaveCount(13, EVENTUALLY);
    await expect(undoBtn(mia.page)).toBeDisabled(); // Mia's history is exhausted; Raj's note is not hers to undo
    await expect(redoBtn(mia.page)).toBeEnabled();
    expect(mia.errors).toEqual([]);
    expect(raj.errors).toEqual([]);
    await mia.context.close(); await raj.context.close();
  });

  test('TC-23 undoing the move of a note the colleague deleted does nothing, and the next undo works', async ({ browser, request, baseURL }) => {
    const id = await seeded(request, baseURL!, buildRetro);
    const [mia, raj] = await openParticipants(browser, ['Mia', 'Raj'], id);
    await expect(notesOf(mia.page)).toHaveCount(12, EVENTUALLY);
    const noteAt = async (page: Page, i: number) => page.locator('[data-sticky]').filter({ hasText: `other ${i}` });
    const first = await noteAt(mia.page, 0);
    const second = await noteAt(mia.page, 1);
    const firstId = (await first.getAttribute('data-id'))!;
    const secondId = (await second.getAttribute('data-id'))!;
    const startX = await first.getAttribute('data-x');
    const startY = await first.getAttribute('data-y');

    await drag(mia.page, screenOf(-500, 250), 0, -100); // step 1: move the first note
    await settled(mia.page);
    await drag(mia.page, screenOf(-290, 250), 0, -100); // step 2: move the second note
    await settled(mia.page);
    await expect(mia.page.locator(`[data-id="${secondId}"]`)).not.toHaveAttribute('data-y', '150');

    await expect(raj.page.locator(`[data-id="${secondId}"]`)).toHaveAttribute('data-y', /.+/, EVENTUALLY);
    await raj.page.locator(`[data-id="${secondId}"]`).click();
    await raj.page.keyboard.press('Delete');
    await expect(notesOf(raj.page)).toHaveCount(11);
    await expect(notesOf(mia.page)).toHaveCount(11, EVENTUALLY);

    await mia.page.keyboard.press(`${MOD}+z`); // targets the deleted note: nothing visible happens
    await expect(notesOf(mia.page)).toHaveCount(11);
    await expect(notesOf(raj.page)).toHaveCount(11);
    await expect(mia.page.locator(`[data-id="${secondId}"]`)).toHaveCount(0);
    await expect(mia.page.locator(`[data-id="${firstId}"]`)).not.toHaveAttribute('data-y', startY!);

    await mia.page.keyboard.press(`${MOD}+z`); // the next undo continues normally
    await expect(mia.page.locator(`[data-id="${firstId}"]`)).toHaveAttribute('data-y', startY!);
    await expect(mia.page.locator(`[data-id="${firstId}"]`)).toHaveAttribute('data-x', startX!);
    await expect(raj.page.locator(`[data-id="${firstId}"]`)).toHaveAttribute('data-y', startY!, EVENTUALLY);
    await expect(raj.page.locator(`[data-id="${secondId}"]`)).toHaveCount(0);
    expect(mia.errors).toEqual([]);
    expect(raj.errors).toEqual([]);
    await mia.context.close(); await raj.context.close();
  });

  test('TC-24 everyone undoing at once reverts only their own changes', async ({ browser, request, baseURL }) => {
    const id = await seeded(request, baseURL!, buildTwoRows);
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Editor ${i}`);
    const people = await openParticipants(browser, names, id);
    for (const p of people) await expect(notesOf(p.page)).toHaveCount(MAX_CONCURRENT_EDITORS * 2, EVENTUALLY);
    const before = await boardSnapshot(people[0].page);

    await Promise.all(people.map(async ({ page }, i) => {
      await drag(page, screenOf(-400 + i * 250, 200), 0, 150); // move mover i
      await page.mouse.dblclick(screenOf(-400 + i * 250, -100).x, screenOf(-400 + i * 250, -100).y); // type in typist i
      await page.keyboard.type(`typed by ${i}`);
      await page.keyboard.press('Escape');
    }));
    for (const p of people) {
      await expect.poll(async () => (await boardSnapshot(p.page)).filter((s) => s.includes('typed by')).length, EVENTUALLY)
        .toBe(MAX_CONCURRENT_EDITORS);
    }
    const edited = await boardSnapshot(people[0].page);
    expect(edited).not.toEqual(before);

    // one person undoes first: only their own two changes go away
    await people[0].page.keyboard.press(`${MOD}+z`);
    await people[0].page.keyboard.press(`${MOD}+z`);
    await expect.poll(async () => (await boardSnapshot(people[1].page)).filter((s) => s.includes('typed by')).length, EVENTUALLY)
      .toBe(MAX_CONCURRENT_EDITORS - 1);
    expect((await boardSnapshot(people[1].page)).some((s) => s.includes('typed by 1'))).toBe(true);

    await Promise.all(people.slice(1).map(async ({ page }) => {
      await page.keyboard.press(`${MOD}+z`);
      await page.keyboard.press(`${MOD}+z`);
    }));
    for (const p of people) await expect.poll(() => boardSnapshot(p.page), EVENTUALLY).toEqual(before);
    for (const p of people) {
      expect(p.errors).toEqual([]);
      await p.context.close();
    }
  });
});
