// Story 3 — See other people's edits appear live on the same board.
import { test, expect, requires, openBoard, joinBoard, notes, createNote, box, drag, shot, caretTo, clickEmpty } from './fixtures';

// PRD: 1 s delivery. Allow harness overhead on top (Playwright polling, local workerd).
const LIVE_MS = 2_000;
const RECONNECT_MS = 30_000;
const PIXEL_TOLERANCE = 1.5;

test.describe('story 3 @s03', () => {
  test.beforeEach(() => requires(3));

  test('create, type, move, recolour and delete reach the other person @ref prd:live.propagate', async ({ newPerson }) => {
    const alex = await newPerson();
    const sam = await newPerson();
    const url = await openBoard(alex);
    await joinBoard(sam, url);

    await alex.mouse.dblclick(400, 300);
    await expect(notes(sam)).toHaveCount(1, { timeout: LIVE_MS });
    await alex.keyboard.type('Pricing');
    await expect(notes(sam).first()).toContainText('Pricing', { timeout: LIVE_MS });
    await alex.keyboard.press('Escape');

    const before = await box(notes(alex).first());
    const samBefore = await box(notes(sam).first());
    await drag(sam, { x: samBefore.x + 20, y: samBefore.y + 20 }, { x: samBefore.x + 220, y: samBefore.y + 20 });
    await expect.poll(async () => (await box(notes(alex).first())).x - before.x, { timeout: LIVE_MS })
      .toBeGreaterThan(200 - PIXEL_TOLERANCE);

    const bg = await notes(sam).first().evaluate((e) => getComputedStyle(e).backgroundColor);
    await notes(alex).first().click();
    await alex.getByRole('button', { name: 'Pink colour' }).click();
    await expect.poll(() => notes(sam).first().evaluate((e) => getComputedStyle(e).backgroundColor),
      { timeout: LIVE_MS }).not.toBe(bg);

    await shot(sam, 's03-golden-sam');
    await alex.keyboard.press('Delete');
    await expect(notes(sam)).toHaveCount(0, { timeout: LIVE_MS });
  });

  test('late joiner sees current notes @ref prd:live.join_state', async ({ newPerson }) => {
    const alex = await newPerson();
    const url = await openBoard(alex);
    for (let i = 0; i < 5; i++) await createNote(alex, { x: 250 + i * 160, y: 300 }, `n${i}`);
    const late = await newPerson();
    await joinBoard(late, url);
    await expect(notes(late)).toHaveCount(5, { timeout: LIVE_MS });
    for (let i = 0; i < 5; i++) await expect(notes(late).filter({ hasText: `n${i}` })).toHaveCount(1);
  });

  test('simultaneous typing keeps both people\'s characters @ref prd:live.concurrent_text', async ({ newPerson }) => {
    const alex = await newPerson();
    const sam = await newPerson();
    const url = await openBoard(alex);
    await joinBoard(sam, url);
    await createNote(alex, { x: 500, y: 350 }, 'green');
    await expect(notes(sam).first()).toContainText('green', { timeout: LIVE_MS });

    await notes(alex).first().dblclick();
    await caretTo(alex, 'start');
    await notes(sam).first().dblclick();
    await caretTo(sam, 'end');
    await Promise.all([alex.keyboard.type('red ', { delay: 30 }), sam.keyboard.type(' blue', { delay: 30 })]);
    await alex.keyboard.press('Escape');
    await sam.keyboard.press('Escape');
    // Escape leaves the note selected, and the design lets its toolbar live inside the note
    // element; deselect so the assertion reads only the note's text.
    await clickEmpty(alex);
    await clickEmpty(sam);
    for (const p of [alex, sam]) {
      await expect(notes(p).first()).toHaveText(/^\s*red green blue\s*$/, { timeout: LIVE_MS });
    }
  });

  test('boards stay separate @ref prd:live.isolation', async ({ newPerson }) => {
    const a = await newPerson();
    const b = await newPerson();
    await openBoard(a);
    await openBoard(b);
    expect(a.url()).not.toBe(b.url());
    await createNote(a, { x: 400, y: 300 }, 'only-on-a');
    await b.waitForTimeout(LIVE_MS);
    await expect(notes(b)).toHaveCount(0);
  });

  test('selection stays personal @ref prd:live.local_selection', async ({ newPerson }) => {
    const alex = await newPerson();
    const sam = await newPerson();
    const url = await openBoard(alex);
    await joinBoard(sam, url);
    const n = await createNote(alex, { x: 400, y: 300 }, 'mine');
    await expect(notes(sam)).toHaveCount(1, { timeout: LIVE_MS });
    await n.click();
    await expect(alex.getByRole('button', { name: 'Delete note' })).toBeVisible();
    await sam.waitForTimeout(LIVE_MS / 2);
    await expect(sam.getByRole('button', { name: 'Delete note' })).toBeHidden();
  });

  test('server restart shows Reconnecting… then Connected, notes kept @ref prd:live.status', async ({ newPerson, app }) => {
    const alex = await newPerson();
    const url = await openBoard(alex);
    await createNote(alex, { x: 400, y: 300 }, 'survivor');
    await app.restart();
    // Either state may already have passed by the time the server is back; at least one must show.
    await expect(alex.getByText(/Reconnecting…|Connected/).first()).toBeVisible({ timeout: RECONNECT_MS });
    await expect(alex.getByText('Reconnecting…')).toHaveCount(0, { timeout: RECONNECT_MS });
    await createNote(alex, { x: 800, y: 300 }, 'after');
    const sam = await newPerson();
    await joinBoard(sam, url);
    await expect(notes(sam).filter({ hasText: 'survivor' })).toHaveCount(1, { timeout: LIVE_MS });
    await expect(notes(sam).filter({ hasText: 'after' })).toHaveCount(1, { timeout: LIVE_MS });
  });

  test('offline edits catch up on reconnect @ref prd:live.catch_up', async ({ newPerson }) => {
    const alex = await newPerson();
    const alexCtx = alex.context();
    const sam = await newPerson();
    const url = await openBoard(alex);
    await joinBoard(sam, url);
    await alexCtx.setOffline(true);
    await expect(alex.getByText('Reconnecting…')).toBeVisible({ timeout: RECONNECT_MS });
    await createNote(alex, { x: 300, y: 300 }, 'from-alex');
    await createNote(sam, { x: 800, y: 300 }, 'from-sam');
    await alexCtx.setOffline(false);
    for (const p of [alex, sam]) await expect(notes(p)).toHaveCount(2, { timeout: RECONNECT_MS });
  });
});
