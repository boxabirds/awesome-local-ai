// Story 4 — Return to a board and find everything as it was left.
import { test, expect, requires, openBoard, joinBoard, notes, createNote, box, shot } from './fixtures';

const LIVE_MS = 2_000;
const PIXEL_TOLERANCE = 1.5;
const LARGE_BOARD_NOTES = 25;
const NOTES_PER_ROW = 5;
const NOTE_SPACING_PX = 110;

test.describe('story 4 @s04', () => {
  test.beforeEach(() => requires(4));

  test('board is intact after everyone leaves @ref prd:persist.reopen', async ({ newPerson }) => {
    const alex = await newPerson();
    const url = await openBoard(alex);
    await alex.getByRole('button', { name: 'Zoom out' }).click();
    await alex.getByRole('button', { name: 'Zoom out' }).click();
    for (let i = 0; i < LARGE_BOARD_NOTES; i++) {
      const col = i % NOTES_PER_ROW, row = Math.floor(i / NOTES_PER_ROW);
      await createNote(alex, { x: 300 + col * NOTE_SPACING_PX, y: 150 + row * NOTE_SPACING_PX }, `p${i}`);
    }
    const ref = await box(notes(alex).filter({ hasText: 'p7' }));
    const refZoomed = await alex.getByText(/^\d+%$/).first().innerText();
    // Give the change time to be acknowledged, then everyone leaves.
    await alex.waitForTimeout(LIVE_MS);
    await alex.context().close();

    const priya = await newPerson();
    await joinBoard(priya, url);
    await expect(notes(priya)).toHaveCount(LARGE_BOARD_NOTES, { timeout: LIVE_MS * 2 });
    // Same zoom as Alex had, so the saved position can be compared on screen.
    await priya.getByRole('button', { name: 'Zoom out' }).click();
    await priya.getByRole('button', { name: 'Zoom out' }).click();
    await expect(priya.getByText(/^\d+%$/).first()).toHaveText(refZoomed);
    const again = await box(notes(priya).filter({ hasText: 'p7' }));
    expect(Math.abs(again.x - ref.x)).toBeLessThan(PIXEL_TOLERANCE);
    expect(Math.abs(again.y - ref.y)).toBeLessThan(PIXEL_TOLERANCE);
    await shot(priya, 's04-reopened');
  });

  test('change seen by another person survives immediate leave + restart @ref prd:persist.seen_is_saved', async ({ newPerson, app }) => {
    const alex = await newPerson();
    const sam = await newPerson();
    const url = await openBoard(alex);
    await joinBoard(sam, url);
    await createNote(alex, { x: 400, y: 300 }, 'seen');
    await expect(notes(sam).filter({ hasText: 'seen' })).toHaveCount(1, { timeout: LIVE_MS });
    await alex.context().close();
    await sam.context().close();
    await app.restart();
    const back = await newPerson();
    await joinBoard(back, url);
    await expect(notes(back).filter({ hasText: 'seen' })).toHaveCount(1, { timeout: LIVE_MS * 2 });
  });

  test('survives restart with nobody connected @ref prd:persist.restart', async ({ newPerson, app }) => {
    const alex = await newPerson();
    const url = await openBoard(alex);
    await createNote(alex, { x: 400, y: 300 }, 'one');
    await createNote(alex, { x: 700, y: 300 }, 'two');
    await alex.waitForTimeout(LIVE_MS);
    await alex.context().close();
    await app.restart();
    const back = await newPerson();
    await joinBoard(back, url);
    await expect(notes(back)).toHaveCount(2, { timeout: LIVE_MS * 2 });
  });

  test('no save button or saved indicator @ref prd:persist.automatic', async ({ newPerson }) => {
    const alex = await newPerson();
    await openBoard(alex);
    await expect(alex.getByRole('button', { name: /^save/i })).toHaveCount(0);
    await expect(alex.getByText(/last saved/i)).toHaveCount(0);
  });
});
