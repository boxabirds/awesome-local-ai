import { expect, test } from '@playwright/test';
import {
  CATCH_UP_TEST_OUTAGE_MS, E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import {
  boardSnapshot, dragNote, expectEventually, notesOf, openParticipants, pos,
} from './helpers/participants';

const EMPTY_SPOT = { x: 1100, y: 700 };

test.describe('Two-person workshop', () => {
  test('TC-22 every kind of change reaches the other person', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    const a = alex.page;
    const s = sam.page;

    // create + type
    let t = Date.now();
    await a.mouse.dblclick(400, 300);
    await expectEventually('create', () => notesOf(s).count(), 1, t);
    t = Date.now();
    await a.keyboard.type('Pricing');
    await expectEventually('text', () => boardSnapshot(s).then((n) => n[0]?.text), 'Pricing', t);
    await a.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);

    // move
    const before = await pos(notesOf(s).first());
    t = Date.now();
    await dragNote(a, notesOf(a).first(), 150, 80);
    await expectEventually('move', () => pos(notesOf(s).first()), ([x, y]: [number, number]) => x === before[0] + 150 && y === before[1] + 80, t);

    // recolour
    await notesOf(a).first().click();
    t = Date.now();
    await a.getByRole('button', { name: 'Green colour' }).click();
    await expectEventually('recolour', () => boardSnapshot(s).then((n) => n[0]?.bg), 'rgb(197, 225, 165)', t);

    // delete
    t = Date.now();
    await a.keyboard.press('Delete');
    await expectEventually('delete', () => notesOf(s).count(), 0, t);

    await alex.context.close();
    await sam.context.close();
  });

  test('TC-23 simultaneous typing in one note keeps every character', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    await alex.page.mouse.dblclick(400, 300);
    await expectEventually('create', () => notesOf(sam.page).count(), 1);
    await sam.page.mouse.dblclick(420, 300);
    await expect(sam.page.getByRole('textbox', { name: 'Note text' })).toBeVisible();
    const aWord = 'alphabetagamma';
    const sWord = 'XYZ123789';
    await Promise.all([
      alex.page.keyboard.type(aWord, { delay: 30 }),
      sam.page.keyboard.type(sWord, { delay: 30 }),
    ]);
    const bothComplete = (text: string) => [...aWord].every((ch) => text.includes(ch)) && sWord.split('').every((ch) => text.includes(ch))
      && text.length === aWord.length + sWord.length;
    await expectEventually('merged text (alex)', () => alex.page.getByRole('textbox', { name: 'Note text' }).inputValue(), bothComplete);
    const texts = await Promise.all([alex.page, sam.page].map((p) => p.getByRole('textbox', { name: 'Note text' }).inputValue()));
    expect(texts[0]).toBe(texts[1]);
    // each person's own characters stay in the order they were typed (the two words use disjoint characters)
    expect(texts[0].replace(/[^a-z]/g, '')).toBe(aWord);
    expect(texts[0].replace(/[a-z]/g, '')).toBe(sWord);
    await alex.context.close();
    await sam.context.close();
  });

  test('TC-24 dragging the same note at once settles to one position', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    await alex.page.mouse.dblclick(400, 300);
    await alex.page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
    await expectEventually('create', () => notesOf(sam.page).count(), 1);
    const t = Date.now();
    await Promise.all([
      dragNote(alex.page, notesOf(alex.page).first(), 200, 100),
      dragNote(sam.page, notesOf(sam.page).first(), -150, 120),
    ]);
    await expect.poll(async () => JSON.stringify(await pos(notesOf(alex.page).first())) === JSON.stringify(await pos(notesOf(sam.page).first())), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    }).toBe(true);
    console.log(`[latency] drag settle: ${Date.now() - t} ms`);
    await alex.context.close();
    await sam.context.close();
  });

  test('TC-25 deleting a note that someone is typing in ends their editing quietly', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    await alex.page.mouse.dblclick(400, 300);
    await alex.page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
    await expectEventually('create', () => notesOf(sam.page).count(), 1);
    await sam.page.mouse.dblclick(420, 300);
    await sam.page.keyboard.type('typing');
    await expect(sam.page.getByRole('textbox', { name: 'Note text' })).toBeVisible();
    await notesOf(alex.page).first().click();
    await alex.page.keyboard.press('Delete');
    await expectEventually('delete during edit', () => notesOf(sam.page).count(), 0);
    await expect(sam.page.getByRole('textbox', { name: 'Note text' })).toHaveCount(0);
    await expect(sam.page.getByRole('alertdialog')).toHaveCount(0);
    await sam.page.waitForTimeout(500);
    expect(sam.errors).toEqual([]);
    expect(alex.errors).toEqual([]);
    await alex.context.close();
    await sam.context.close();
  });

  test('TC-28 selecting and editing stays personal', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    await alex.page.mouse.dblclick(400, 300);
    await alex.page.keyboard.type('mine');
    await expectEventually('create', () => notesOf(sam.page).count(), 1);
    await expectEventually('text', () => boardSnapshot(sam.page).then((n) => n[0]?.text), 'mine');
    await expect(notesOf(sam.page).first()).toHaveAttribute('data-selected', 'false');
    await expect(sam.page.getByRole('textbox', { name: 'Note text' })).toHaveCount(0);
    await alex.context.close();
    await sam.context.close();
  });
});

test('TC-26 full-capacity session: every change reaches every participant', async ({ browser }) => {
  test.setTimeout(120_000);
  const people = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
  const perPerson = 5;
  for (const [i, p] of people.entries()) {
    for (let k = 0; k < perPerson; k++) {
      const x = 150 + i * 200;
      const y = 120 + k * 110;
      await p.page.mouse.dblclick(x, y);
      await p.page.keyboard.type(`p${i}n${k}`);
      await p.page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
    }
  }
  const total = MAX_CONCURRENT_EDITORS * perPerson;
  for (const p of people) await expectEventually('create (all see)', () => notesOf(p.page).count(), total);
  // each person moves their own first five notes
  for (const [i, p] of people.entries()) {
    const mine = p.page.getByRole('group', { name: 'Sticky note' }).filter({ hasText: `p${i}n` });
    for (let k = 0; k < perPerson; k++) await dragNote(p.page, mine.nth(k), 0, 0).catch(() => undefined);
    await dragNote(p.page, mine.first(), 20, 20);
  }
  await expect.poll(async () => {
    const snaps = await Promise.all(people.map((p) => boardSnapshot(p.page)));
    return snaps.every((s) => JSON.stringify(s) === JSON.stringify(snaps[0]));
  }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(true);
  for (const p of people) await p.context.close();
});

test('TC-27 flaky Wi-Fi: offline edits catch up in both directions', async ({ browser }) => {
  test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 150_000);
  const [alex, sam] = await openParticipants(browser, 2);
  const badge = alex.page.getByRole('status').filter({ hasText: /Reconnecting|Connected|Connecting/ });
  await alex.context.setOffline(true);
  const offlineAt = Date.now();
  // An already-open socket is only noticed as dead once the provider's message timeout (30 s) passes.
  await expect(badge).toHaveText('Reconnecting…', { timeout: 60_000 });
  // board stays editable while offline
  for (let k = 0; k < 3; k++) {
    await alex.page.mouse.dblclick(150 + k * 220, 150);
    await alex.page.keyboard.type(`alex${k}`);
    await alex.page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
    await sam.page.mouse.dblclick(150 + k * 220, 450);
    await sam.page.keyboard.type(`sam${k}`);
    await sam.page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
  }
  await expect(notesOf(alex.page)).toHaveCount(3);
  await alex.page.waitForTimeout(Math.max(0, CATCH_UP_TEST_OUTAGE_MS - (Date.now() - offlineAt)));
  await alex.context.setOffline(false);
  await expect(badge).toHaveText('Connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 });
  await expect(badge).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expectEventually('catch-up (alex)', () => notesOf(alex.page).count(), 6);
  await expectEventually('catch-up (sam)', () => notesOf(sam.page).count(), 6);
  expect(await boardSnapshot(alex.page)).toEqual(await boardSnapshot(sam.page));
  await alex.context.close();
  await sam.context.close();
});
