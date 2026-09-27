// End-to-end tests: the parts of story 2 that need a real browser — pixel
// accurate creation and dragging at different zooms, notes raised above each
// other, the measurement-driven font fit and overflow, and creating a note when
// panned far away. Covers TC-30 to TC-34 plus the brainstorm golden path.
import { expect, test, type Page } from '@playwright/test';

import {
  expectWithin,
  openBoard,
  setCamera,
  waitForRender,
} from './helpers/board';

const stickyNotes = (page: Page) => page.getByTestId('sticky-note');
const noteAt = (page: Page, index: number) => page.getByTestId('sticky-note').nth(index);
const noteTextbox = (page: Page) => page.getByRole('textbox', { name: 'Sticky note text' });
const createStickyButton = (page: Page) => page.getByTestId('create-sticky');

const VIEWPORT = { width: 1280, height: 800 };

/** ~1,000 characters of realistic English prose (never a repeated single char). */
const NOTE_SENTENCE =
  'The product team gathered to sketch ideas for a smoother onboarding and kept ' +
  'one sticky note for every thought worth keeping. They clustered welcome copy, ' +
  'empty states, and first run tips, then rearranged the notes until the story ' +
  'flowed. Feedback arrived fast, colour coded by theme, and the loudest notes ' +
  'rose to the front for discussion. By the end of the session the wall told a ' +
  'clear story, and everyone could see exactly what came next on the roadmap. ';
const TEXT_1000 = NOTE_SENTENCE.repeat(8).slice(0, 1000);

/** Double-click empty board at a screen point (leaves the new note editing). */
async function dblClickCreate(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.dblclick(x, y);
  await waitForRender(page);
}

/** Stop editing while keeping the note selected, so it can be dragged. */
async function commitEdit(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await waitForRender(page);
}

async function boxCentre(page: Page, index: number): Promise<{ x: number; y: number; left: number; top: number }> {
  const box = await noteAt(page, index).boundingBox();
  if (box === null) throw new Error('sticky note has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, left: box.x, top: box.y };
}

interface NoteGeom {
  x: number;
  y: number;
  z: number;
}

/** Every note's world position and stacking, read from the inline styles. */
function allNotes(page: Page): Promise<NoteGeom[]> {
  return stickyNotes(page).evaluateAll((els) =>
    els.map((el) => {
      const e = el as HTMLElement;
      return {
        x: Number.parseFloat(e.style.left),
        y: Number.parseFloat(e.style.top),
        z: Number(e.style.zIndex),
      };
    }),
  );
}

function noteWorld(page: Page, index: number): Promise<NoteGeom> {
  return noteAt(page, index).evaluate((el) => ({
    x: Number.parseFloat((el as HTMLElement).style.left),
    y: Number.parseFloat((el as HTMLElement).style.top),
    z: Number((el as HTMLElement).style.zIndex),
  }));
}

async function dragNote(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
  await waitForRender(page);
}

const unavailableBrowsers = (process.env.VIDI6_UNAVAILABLE_BROWSERS ?? '').split(',').filter(Boolean);
test.beforeEach(({ browserName }) => {
  test.skip(
    unavailableBrowsers.includes(browserName),
    `${browserName} cannot launch on this host (missing system libraries)`,
  );
});

test('TC-30 double-click creates a note centred on the point and types into it', async ({ page }) => {
  await openBoard(page);
  await dblClickCreate(page, 400, 300);
  await expect(stickyNotes(page)).toHaveCount(1);

  const centre = await boxCentre(page, 0);
  expectWithin(centre.x, 400, 1.5, 'note centre x');
  expectWithin(centre.y, 300, 1.5, 'note centre y');

  await page.keyboard.type('Hello');
  await commitEdit(page);

  const text = await noteAt(page, 0).locator('.sticky-note__text').textContent();
  expect((text ?? '').trim()).toBe('Hello');
  await expect(page.getByTestId('note-toolbar')).toBeVisible();
});

test('TC-31 dragging at 50% moves the world position by the drag divided by zoom', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, { zoom: 0.5 });
  await dblClickCreate(page, 640, 400);
  await commitEdit(page);

  const before = await noteWorld(page, 0);
  const start = await boxCentre(page, 0);
  await dragNote(page, start, 100, 50);

  const after = await noteWorld(page, 0);
  expectWithin(after.x - before.x, 200, 1.5, 'world dx @50%');
  expectWithin(after.y - before.y, 100, 1.5, 'world dy @50%');

  const end = await boxCentre(page, 0);
  expectWithin(end.x - start.x, 100, 1.5, 'screen dx');
  expectWithin(end.y - start.y, 50, 1.5, 'screen dy');
});

test('TC-32 dragging at 200% divides the on-screen movement by two', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, { zoom: 2 });
  await dblClickCreate(page, 640, 400);
  await commitEdit(page);

  const before = await noteWorld(page, 0);
  const start = await boxCentre(page, 0);
  await dragNote(page, start, 100, 50);

  const after = await noteWorld(page, 0);
  expectWithin(after.x - before.x, 50, 1.5, 'world dx @200%');
  expectWithin(after.y - before.y, 25, 1.5, 'world dy @200%');
});

test('TC-32 dragging a covered note raises it above the note it overlaps', async ({ page }) => {
  await openBoard(page);
  // Note A (created first, lower) partly under note B (created from the toolbar,
  // centred on the viewport centre, on top).
  await dblClickCreate(page, 560, 400);
  await commitEdit(page);
  await createStickyButton(page).click();
  await waitForRender(page);
  await commitEdit(page);
  await expect(stickyNotes(page)).toHaveCount(2);

  const before = await allNotes(page);
  const a = before[0]; // lower note
  expect(a.z).toBeLessThan(before[1].z);

  // Grab A on its exposed left edge (B does not cover it there) and nudge it.
  const boxA = await noteAt(page, 0).boundingBox();
  if (boxA === null) throw new Error('no box for A');
  await dragNote(page, { x: boxA.x + 15, y: boxA.y + boxA.height / 2 }, 40, 0);

  const after = await allNotes(page);
  const expectedX = a.x + 40; // zoom 1 → 40 screen px = 40 world
  const dragged = after.reduce((best, n) =>
    Math.abs(n.x - expectedX) + Math.abs(n.y - a.y) <
    Math.abs(best.x - expectedX) + Math.abs(best.y - a.y)
      ? n
      : best,
  );
  const kept = after.find((n) => n !== dragged) as NoteGeom;
  expect(dragged.z).toBeGreaterThan(kept.z);
});

test('TC-33 long text shrinks the font to fit, then clips with a fade at the minimum', async ({ page }) => {
  await openBoard(page);
  await dblClickCreate(page, 500, 400);
  await expect(stickyNotes(page)).toHaveCount(1);
  await page.keyboard.type('Brainstorm');
  await commitEdit(page);

  const fontSizeShort = await noteAt(page, 0)
    .locator('.sticky-note__text')
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(fontSizeShort).toBeCloseTo(24, 0.5);

  // Re-enter editing and paste 1,000 characters.
  await page.keyboard.press('Enter');
  await waitForRender(page);
  await noteTextbox(page).fill(TEXT_1000);
  await waitForRender(page);

  const fontSizeLong = await noteAt(page, 0)
    .locator('.sticky-note__text')
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(fontSizeLong).toBeGreaterThanOrEqual(10);
  expect(fontSizeLong).toBeLessThanOrEqual(24);

  await expect(noteAt(page, 0)).toHaveAttribute('data-overflow', 'true');
  await expect(noteAt(page, 0).locator('.sticky-note__fade')).toHaveCount(1);
  await expect(page.getByTestId('sticky-counter')).toHaveText('1000/1000');
});

test('TC-34 creating from the toolbar while panned far away puts a note on screen', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, { x: 1_234_567, y: -987_654 });
  await createStickyButton(page).click();
  await waitForRender(page);
  await expect(stickyNotes(page)).toHaveCount(1);

  const centre = await boxCentre(page, 0);
  expectWithin(centre.x, VIEWPORT.width / 2, 3, 'centred on viewport x');
  expectWithin(centre.y, VIEWPORT.height / 2, 3, 'centred on viewport y');
  expect(centre.x).toBeGreaterThan(0);
  expect(centre.x).toBeLessThan(VIEWPORT.width);
});

test('golden path — create, type, recolour, move and delete', async ({ page }) => {
  await openBoard(page);
  await dblClickCreate(page, 400, 300);
  await page.keyboard.type('Faster onboarding');
  await commitEdit(page);

  await page.getByRole('button', { name: 'Pink colour' }).click();
  await waitForRender(page);
  await expect(noteAt(page, 0)).toHaveAttribute('data-color', 'pink');

  const start = await boxCentre(page, 0);
  await dragNote(page, start, 80, 40);
  await expect(stickyNotes(page)).toHaveCount(1);

  await page.getByRole('button', { name: 'Delete note' }).click();
  await waitForRender(page);
  await expect(stickyNotes(page)).toHaveCount(0);
});
