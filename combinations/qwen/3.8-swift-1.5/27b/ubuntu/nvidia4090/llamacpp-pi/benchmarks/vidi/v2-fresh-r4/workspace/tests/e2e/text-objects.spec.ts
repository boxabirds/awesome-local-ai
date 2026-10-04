import { test, expect, type Page } from '@playwright/test';
import { setCamera, settle } from './helpers/board';
import {
  openParticipants,
  closeParticipants,
  expectEventually,
  createBoardViaApi,
  createBoardId,
  type Participant,
} from './helpers/participants';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { ANNOTATION_300 } from '../fixtures/texts';

/** The rendered box of the nth text object (screen px). */
async function textBox(page: Page, index = 0): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('[data-vidi6="text"]').nth(index).boundingBox();
  if (!box) throw new Error(`text object ${index} has no bounding box`);
  return box;
}

async function textCount(page: Page): Promise<number> {
  return page.locator('[data-vidi6="text"]').count();
}

/** Rendered text content (display mode only — not while editing). */
async function textContent(page: Page, index = 0): Promise<string> {
  const el = page.locator('[data-vidi6="text-content"]').nth(index);
  return (await el.textContent()) ?? '';
}

/**
 * Press T (text tool) and click at screen (x, y): creates a size-M text
 * object with its top-left at the click point and starts editing it.
 */
async function createTextAt(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.press('t');
  await page.mouse.click(x, y);
  await expect(page.locator('[data-vidi6="text-editor"]')).toBeVisible({ timeout: 5000 });
}

test.describe('story 9: free text e2e', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const boardId = await createBoardViaApi(baseURL!);
    await page.goto(`/b/${boardId}`);
    await page.waitForSelector('[data-vidi6="board-viewport"]', { timeout: 15000 });
    // Default camera: world (0,0) at screen centre, zoom 1
    await setCamera(page, { x: -640, y: -400, zoom: 1 });
    await settle(page);
  });

  // TC-26: 300-character annotation → width capped at the maximum auto width,
  // wrapped onto several lines.
  test('TC-26: long annotation wraps at the maximum auto width', async ({ page }) => {
    await createTextAt(page, 340, 250);
    await page.keyboard.type(ANNOTATION_300);
    await page.keyboard.press('Escape');
    await settle(page);

    expect(await textCount(page)).toBe(1);
    const box = await textBox(page);
    // Stored width is the maximum auto width (±2 for rounding)
    expect(box.width).toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 2);
    expect(box.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);
    // Several rendered lines (M: 20px × 1.3 = 26px per line; > 2 lines)
    expect(box.height).toBeGreaterThan(2 * TEXT_SIZES.M * 1.3);
  });

  // TC-27: only e/w handles; dragging the right handle narrower rewraps and
  // grows the height.
  test('TC-27: horizontal-only handles; dragging narrower grows the height', async ({ page }) => {
    await createTextAt(page, 340, 250);
    await page.keyboard.type(ANNOTATION_300);
    await page.keyboard.press('Escape');
    await settle(page);

    // Only east and west handles exist
    await expect(page.locator('[data-vidi6="selection-handle"][data-handle="e"]')).toHaveCount(1);
    await expect(page.locator('[data-vidi6="selection-handle"][data-handle="w"]')).toHaveCount(1);
    for (const dir of ['n', 's', 'nw', 'ne', 'se', 'sw']) {
      await expect(page.locator(`[data-vidi6="selection-handle"][data-handle="${dir}"]`)).toHaveCount(0);
    }

    const before = await textBox(page);

    // Drag the east handle 300px to the left (zoom 1 → world px)
    const handle = await page.locator('[data-vidi6="selection-handle"][data-handle="e"]').boundingBox();
    if (!handle) throw new Error('east handle has no bounding box');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 - 300, handle.y + handle.height / 2, { steps: 10 });
    await page.mouse.up();
    await settle(page);

    const after = await textBox(page);
    // Width shrank by ~300 world units
    expect(after.width).toBeLessThan(before.width - 250);
    // The same text in a narrower box needs more lines
    expect(after.height).toBeGreaterThan(before.height);
  });

  // TC-28: title a retro section — create, size XL, move, delete, undo.
  test('TC-28: title a retro section (create, XL, move, delete, undo)', async ({ page }) => {
    // A cluster of two sticky notes
    await page.mouse.dblclick(700, 450);
    await page.keyboard.press('Escape');
    await page.mouse.dblclick(820, 450);
    await page.keyboard.press('Escape');
    await settle(page);

    // Text above the cluster (clear of the notes and their toolbars)
    await createTextAt(page, 700, 300);
    await page.keyboard.type('Went well');
    await page.keyboard.press('Escape');
    await settle(page);

    expect(await textCount(page)).toBe(1);
    const topLeftBefore = await textBox(page);

    // The text toolbar is visible above the selection
    await expect(page.locator('[data-vidi6="text-toolbar"]')).toBeVisible();

    // Pick XL: the top-left corner stays put
    await page.click('[data-vidi6="text-toolbar"] [aria-label="Text size XL"]');
    await settle(page);

    const afterSize = await textBox(page);
    const fontSize = await page.locator('[data-vidi6="text"]').evaluate((el) => getComputedStyle(el).fontSize);
    expect(fontSize).toBe(`${TEXT_SIZES.XL}px`);
    expect(Math.abs(afterSize.x - topLeftBefore.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(afterSize.y - topLeftBefore.y)).toBeLessThanOrEqual(2);

    // Drag the heading over the cluster
    const cx = afterSize.x + afterSize.width / 2;
    const cy = afterSize.y + afterSize.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(760, 450, { steps: 10 });
    await page.mouse.up();
    await settle(page);

    const afterMove = await textBox(page);
    expect(Math.abs(afterMove.x + afterMove.width / 2 - 760)).toBeLessThanOrEqual(5);
    expect(Math.abs(afterMove.y + afterMove.height / 2 - 450)).toBeLessThanOrEqual(5);

    // Delete it
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-vidi6="text"]')).toHaveCount(0);

    // Undo restores it
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-vidi6="text"]')).toHaveCount(1);
    expect((await textContent(page)).trim()).toBe('Went well');
  });

  // TC-31: abandoned text — T, click, Escape without typing leaves nothing.
  test('TC-31: abandoned text is not created', async ({ page }) => {
    await page.keyboard.press('t');
    await page.mouse.click(500, 300);
    // The editor is open; abandon it
    await expect(page.locator('[data-vidi6="text-editor"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await settle(page);

    // No text object in the doc
    expect(await textCount(page)).toBe(0);

    // Shift+drag (marquee) over the spot selects nothing
    await page.keyboard.down('Shift');
    await page.mouse.move(450, 280);
    await page.mouse.down();
    await page.mouse.move(600, 350, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await settle(page);

    await expect(page.locator('[data-vidi6="selection-overlay"]')).toHaveCount(0);
  });
});

test.describe('story 9: concurrent text editing', () => {
  let boardId: string;
  let participants: Participant[];

  test.beforeEach(() => {
    boardId = createBoardId();
  });

  test.afterEach(async () => {
    if (participants) await closeParticipants(participants);
  });

  // TC-29: two contexts type into the same text simultaneously.
  test('TC-29: two participants type into the same text at once', async ({ browser }) => {
    participants = await openParticipants(browser, 'http://localhost:27240', boardId, 2);
    const [alex, sam] = participants;

    // Alex creates a text (enters edit mode) and starts typing
    await alex.page.keyboard.press('t');
    await alex.page.mouse.click(660, 420);
    await expect(alex.page.locator('[data-vidi6="text-editor"]')).toBeVisible({ timeout: 5000 });
    await alex.page.keyboard.type('Hello ');

    // Sam sees it (with Alex's typed content synced) and starts editing too
    // while Alex is still in edit mode
    await expectEventually(async () => {
      const el = sam.page.locator('[data-vidi6="text-content"]').first();
      const text = (await el.textContent().catch(() => '')) ?? '';
      return text.includes('Hello');
    }, 'Sam sees the text with Alex\'s content');
    await sam.page.locator('[data-vidi6="text"]').first().dblclick();
    await expect(sam.page.locator('[data-vidi6="text-editor"]')).toBeVisible({ timeout: 5000 });

    // Both keep typing into the same text concurrently
    await sam.page.keyboard.type('World');
    await alex.page.keyboard.type('and hello');

    // Both end editing and converge on identical text
    await alex.page.keyboard.press('Escape');
    await sam.page.keyboard.press('Escape');

    await expectEventually(async () => {
      const a = (await alex.page.locator('[data-vidi6="text-content"]').first().textContent()) ?? '';
      const s = (await sam.page.locator('[data-vidi6="text-content"]').first().textContent()) ?? '';
      return a === s && a.includes('Hello') && a.includes('World');
    }, 'Both participants see identical text containing Hello and World');

    const alexText = (await alex.page.locator('[data-vidi6="text-content"]').first().textContent()) ?? '';
    const samText = (await sam.page.locator('[data-vidi6="text-content"]').first().textContent()) ?? '';
    expect(alexText).toBe(samText);
    expect(alexText).toContain('Hello');
    expect(alexText).toContain('World');
  });

  // TC-30: MAX_CONCURRENT_EDITORS participants each create a heading at once.
  test('TC-30: five participants create headings at once', async ({ browser }) => {
    participants = await openParticipants(browser, 'http://localhost:27240', boardId, MAX_CONCURRENT_EDITORS);

    // Each participant creates a heading via the Text tool, concurrently
    await Promise.all(
      participants.map(async (p, i) => {
        const x = 300 + i * 150;
        const y = 250 + (i % 2) * 100;
        await p.page.keyboard.press('t');
        await p.page.mouse.click(x, y);
        await expect(p.page.locator('[data-vidi6="text-editor"]')).toBeVisible({ timeout: 5000 });
        await p.page.keyboard.type(`Heading ${i + 1}`);
        await p.page.keyboard.press('Escape');
      }),
    );

    // Every participant sees all five headings, fully converged
    for (const p of participants) {
      await expectEventually(async () => {
        if ((await textCountOn(p)) !== MAX_CONCURRENT_EDITORS) return false;
        const contents = ((await p.page.locator('[data-vidi6="text-content"]').allTextContents()) ?? []).sort();
        return contents.every((c) => /^Heading [1-5]$/.test(c));
      }, 'sees all five converged headings');
    }
  });
});

/** Text object count on a participant's page. */
async function textCountOn(p: Participant): Promise<number> {
  return p.page.locator('[data-vidi6="text"]').count();
}
