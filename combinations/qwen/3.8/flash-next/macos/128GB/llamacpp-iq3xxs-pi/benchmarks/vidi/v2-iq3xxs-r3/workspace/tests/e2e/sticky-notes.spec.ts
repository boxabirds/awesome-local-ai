/**
 * Story 2 e2e: sticky notes in a real browser (TC-30 to TC-38), served by
 * `wrangler dev`. Everything the model already guarantees in unit tests is
 * checked here through the rendered board: creation, dragging at a zoom
 * level, recolouring, deletion, long-text fit and the stale-interaction
 * cases. The console must stay clean throughout (TC-37).
 */
import { expect, test, type Page } from '@playwright/test';

import {
  CENTRE,
  collectConsoleProblems,
  expectCamera,
  expectZoomLabel,
  type Point,
} from './helpers/board';
import {
  dblClick,
  deleteNoteBehind,
  dragFrom,
  dragWithStep,
  expectNote,
  expectNoteCount,
  noteCentre,
  notes,
  readNotes,
  textarea,
} from './helpers/notes';
import { PROSE_1000 } from '../fixtures/texts';
import {
  STICKY_COLORS,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';

const INITIAL = { x: -CENTRE.x, y: -CENTRE.y, zoom: 1 };
const NOTE_HALF = STICKY_SIZE_WORLD / 2;

let consoleProblems: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page);
  await page.goto('/');
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expectCamera(page, INITIAL);
});

/** Create a note at the given empty-board point and leave it selected. */
async function createNoteAt(page: Page, at: Point): Promise<void> {
  await dblClick(page, at);
  await expectNote(page, 0, { selected: true });
  await page.keyboard.press('Escape'); // end the auto-started edit
}

test('TC-30: the Sticky note button creates a note centred in the view; the camera does not move and the note is in edit mode', async ({
  page,
}) => {
  await page.getByTestId('create-sticky').click();

  await expectNoteCount(page, 1);
  await expectNote(page, 0, { x: -NOTE_HALF, y: -NOTE_HALF, selected: true });
  const centre = await noteCentre(page, 0);
  expect(centre.x).toBeCloseTo(CENTRE.x, 0);
  expect(centre.y).toBeCloseTo(CENTRE.y, 0);
  await expectCamera(page, INITIAL); // sticky.create_button: no navigation
  await expect(textarea(page)).toBeVisible(); // and it is editing right away
});

test('TC-31: at 50% zoom a 50 px drag moves the note 100 world units (screen delta / zoom)', async ({
  page,
}) => {
  // 50% with the board start still centred: world 0 sits at the screen centre.
  await page.evaluate(
    (centre) => window.__vidi6?.setCamera({ x: -centre.x / 0.5, y: -centre.y / 0.5, zoom: 0.5 }),
    CENTRE,
  );
  await expectZoomLabel(page, '50%');

  await page.getByTestId('create-sticky').click();
  await expectNote(page, 0, { x: -NOTE_HALF, y: -NOTE_HALF });
  await page.keyboard.press('Escape'); // end the auto-started edit, stay selected

  const grab = await noteCentre(page, 0);
  await dragFrom(page, grab, { x: grab.x + 50, y: grab.y });

  // 50 screen pixels at 0.5 zoom = 100 world units; y was not touched.
  await expectNote(page, 0, { x: -NOTE_HALF + 100, y: -NOTE_HALF });
  await expectCamera(page, { x: -CENTRE.x / 0.5, y: -CENTRE.y / 0.5, zoom: 0.5 });
});

test('TC-32: a colour swatch recolours the note pink', async ({ page }) => {
  await createNoteAt(page, CENTRE);
  await expect(page.getByTestId('note-toolbar')).toBeVisible();

  await page.getByTestId('swatch-pink').click();
  await expectNote(page, 0, { color: 'pink', selected: true });
  const background = await notes(page)
    .nth(0)
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(background).toBe('rgb(244, 143, 177)'); // #F48FB1
});

test('TC-33: long text shrinks the font to 10px, fades at the bottom, shows the counter, and the 1,001st character is dropped', async ({
  page,
}) => {
  await page.getByTestId('create-sticky').click();
  await expect(textarea(page)).toBeVisible();

  await page.keyboard.insertText(PROSE_1000.slice(0, 949));
  await expect(page.getByTestId('char-counter')).toBeHidden();
  await page.keyboard.insertText(PROSE_1000.slice(949, 950));
  await expect(page.getByTestId('char-counter')).toHaveText(`950/${STICKY_TEXT_MAX_CHARS}`);

  await page.keyboard.insertText(PROSE_1000.slice(950));
  await expect(page.getByTestId('char-counter')).toHaveText(
    `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
  );

  // The font auto-fit hit its floor and the fade appeared (sticky.text_fit).
  await expectNote(page, 0, { overflow: true });
  const font = await notes(page)
    .nth(0)
    .evaluate((element) => getComputedStyle(element.querySelector('.sticky-text') as Element).fontSize);
  expect(font).toBe(`${STICKY_FONT_MIN_PX}px`);
  await expect(notes(page).nth(0).getByTestId('text-fade')).toBeVisible();
  // The textarea scrolled to the end at the minimum size.
  const scrolled = await textarea(page).evaluate((element) => element.scrollTop > 0);
  expect(scrolled).toBe(true);

  // One character past the limit: dropped, not written.
  await page.keyboard.insertText('x');
  const length = await notes(page)
    .nth(0)
    .evaluate((element) => (element.querySelector('.sticky-text')?.textContent ?? '').length);
  expect(length).toBe(STICKY_TEXT_MAX_CHARS);
});

test('TC-34: clicking overlapping notes selects the topmost; dragging another note raises it above them', async ({
  page,
}) => {
  // Note A spans screen x 500..700; note B (created outside A, at its right
  // edge) spans 630..830. The overlap covers 630..700; only A covers (530,460).
  await createNoteAt(page, { x: 600, y: 400 });
  await dblClick(page, { x: 730, y: 480 });
  await page.keyboard.press('Escape');
  await expectNoteCount(page, 2);

  const before = await readNotes(page);
  const lower = before.reduce((a, b) => (b.z < a.z ? b : a));
  const higher = before.find((note) => note.id !== lower.id) ?? before[0];

  // The point inside both notes: the newer one (higher z) wins.
  await page.mouse.click(660, 440);
  await expect
    .poll(async () => {
      const all = await readNotes(page);
      return all.find((note) => note.id === higher.id)?.selected;
    })
    .toBe(true);
  expect((await readNotes(page)).filter((note) => note.selected)).toHaveLength(1);

  // Drag the lower note from a point only it covers; once the drag starts it
  // is raised above the other one (sticky.move).
  await dragFrom(page, { x: 530, y: 460 }, { x: 700, y: 460 });
  await expect
    .poll(async () => {
      const all = await readNotes(page);
      const moved = all.find((note) => note.id === lower.id);
      const top = all.find((note) => note.id === higher.id);
      if (!moved || !top) return 'note missing';
      return moved.z > top.z ? 'raised' : `moved.z=${moved.z} top.z=${top.z}`;
    })
    .toBe('raised');
  const moved = await readNotes(page).then((all) => all.find((note) => note.id === lower.id));
  expect(moved?.x).toBeCloseTo(lower.x + 170, 0);
});

test('TC-35: a double-click on empty board creates a note and edits it; a double-click on a note edits it instead of creating one', async ({
  page,
}) => {
  await dblClick(page, { x: 900, y: 600 });
  await expectNoteCount(page, 1);
  await expectNote(page, 0, { selected: true });
  await expect(textarea(page)).toBeVisible();
  await page.keyboard.insertText('abc');
  await page.keyboard.press('Escape');

  // A double-click on the note itself: no note on top of it, edit resumes.
  const centre = await noteCentre(page, 0);
  await dblClick(page, centre);
  await expectNoteCount(page, 1);
  await expect(textarea(page)).toBeVisible();
  await expect(notes(page).nth(0).locator('.sticky-text')).toHaveText('abc');
  await page.keyboard.press('Escape');
});

test('TC-36: Escape ends editing with the text kept and the note selected; the view is not reset', async ({
  page,
}) => {
  // Pan away first so a view reset would be visible.
  await page.evaluate(() => window.__vidi6?.setCamera({ x: -300, y: -200, zoom: 1 }));
  await expectCamera(page, { x: -300, y: -200, zoom: 1 });

  await dblClick(page, CENTRE);
  await expect(textarea(page)).toBeVisible();
  await page.keyboard.insertText('stay');
  await page.keyboard.press('Escape');

  await expect(textarea(page)).toBeHidden();
  await expectNote(page, 0, { selected: true });
  await expect(notes(page).nth(0).locator('.sticky-text')).toHaveText('stay');
  await expectCamera(page, { x: -300, y: -200, zoom: 1 }); // nothing reset
  expect((await readNotes(page)).filter((note) => note.selected)).toHaveLength(1);

  // And Enter starts editing the selected note again.
  await page.keyboard.press('Enter');
  await expect(textarea(page)).toBeVisible();
});

test('TC-37: deleting a note mid-drag or mid-edit ends cleanly and the console stays clean', async ({
  page,
}) => {
  await createNoteAt(page, CENTRE);
  const centre = await noteCentre(page, 0);

  // (a) Deleted while a drag is in progress.
  await dragWithStep(page, centre, { x: centre.x + 120, y: centre.y + 60 }, async () => {
    await deleteNoteBehind(page, 0);
  });
  await expectNoteCount(page, 0);

  // (b) Deleted while being edited.
  await dblClick(page, CENTRE);
  await page.keyboard.insertText('half typed');
  await deleteNoteBehind(page, 0);
  await expect(textarea(page).first()).toBeHidden();
  await expectNoteCount(page, 0);
  // Keys pressed afterwards go nowhere; nothing crashes.
  await page.keyboard.insertText('more');
  await page.mouse.click(200, 700);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expectNoteCount(page, 0);

  expect(consoleProblems).toEqual([]);
});

test('TC-38: clicking outside the note ends editing; no phantom edit happens afterwards', async ({
  page,
}) => {
  await dblClick(page, CENTRE);
  await page.keyboard.insertText('abc');

  // A press on empty board space ends the edit as unselected.
  await page.mouse.click(200, 700);
  await expect(textarea(page)).toBeHidden();
  await expectNote(page, 0, { selected: false });

  // Typing afterwards does not reach any note and creates nothing.
  await page.keyboard.insertText('def');
  await expectNoteCount(page, 1);
  await expect(notes(page).nth(0).locator('.sticky-text')).toHaveText('abc');
  await expectCamera(page, INITIAL);
});

test('the note is rendered at STICKY_SIZE_WORLD board units and its colour names are in the toolbar', async ({
  page,
}) => {
  await createNoteAt(page, CENTRE);
  const box = await notes(page).nth(0).boundingBox();
  expect(box?.width).toBeCloseTo(STICKY_SIZE_WORLD, 1);
  expect(box?.height).toBeCloseTo(STICKY_SIZE_WORLD, 1);
  for (const color of Object.keys(STICKY_COLORS)) {
    await expect(page.getByTestId(`swatch-${color}`)).toBeVisible();
  }
});
