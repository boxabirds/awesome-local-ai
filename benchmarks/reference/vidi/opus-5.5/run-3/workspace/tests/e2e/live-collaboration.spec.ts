import { expect, test, type Page } from '@playwright/test';
import { setCamera, settle } from './helpers/board';
import { centreOf, createByDoubleClick, dragBy, noteById, notes } from './helpers/notes';
import {
  closeAll,
  connectionBadge,
  domSnapshot,
  expectWithin,
  openParticipants,
  waitConnected,
  type Participant,
} from './helpers/participants';
import { CATCH_UP_TEST_OUTAGE_MS, CONNECTED_CONFIRMATION_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

async function noteData(page: Page, id: string) {
  return (await notes(page)).find((n) => n.id === id);
}

async function textOf(page: Page, id: string) {
  return (await noteData(page, id))?.text;
}

/** Clicks empty board space: ends editing and deselects. */
async function clickEmpty(page: Page, at = { x: 1200, y: 760 }) {
  await page.mouse.click(at.x, at.y);
}

/** Double-clicks empty space and returns the id of the note this page is now editing (others may be creating too). */
async function createOwn(page: Page, at: { x: number; y: number }): Promise<string> {
  await page.mouse.dblclick(at.x, at.y);
  const editing = page.locator('[data-note-id][data-state="editing"]');
  await expect(editing).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Note text' })).toBeFocused();
  return (await editing.getAttribute('data-note-id'))!;
}

async function editNote(page: Page, id: string) {
  await noteById(page, id).dblclick();
  await expect(page.getByRole('textbox', { name: 'Note text' })).toBeFocused();
}

test.describe('Workflow 1: two-person workshop', () => {
  let people: Participant[] = [];
  test.afterEach(async () => {
    await closeAll(people);
    people = [];
  });

  test('TC-22 → TC-23 → TC-24 → TC-25 every change reaches the other person within the budget', async ({
    browser,
  }) => {
    ({ people } = await openParticipants(browser, ['Alex', 'Sam']));
    const [alex, sam] = people.map((p) => p.page);

    // TC-22 create.
    const id = await createByDoubleClick(alex, { x: 400, y: 300 });
    await expectWithin(() => noteById(sam, id).count(), 'created note on Sam').toBe(1);
    // text: letters arrive as Alex types.
    await alex.keyboard.type('Pricing');
    await expectWithin(() => textOf(sam, id), 'text on Sam').toBe('Pricing');
    await clickEmpty(alex);
    // move.
    await dragBy(alex, await centreOf(alex, id), 250, 120);
    const moved = await noteData(alex, id);
    await expectWithin(async () => {
      const n = await noteData(sam, id);
      return n && { x: n.x, y: n.y };
    }, 'move on Sam').toEqual({ x: moved!.x, y: moved!.y });
    // recolour (the drag left the note selected, so its toolbar is open).
    await alex.getByRole('button', { name: 'Pink colour' }).click();
    await expectWithin(() => noteById(sam, id).getAttribute('data-color'), 'colour on Sam').toBe('pink');
    // Selection stays personal throughout.
    await expect(noteById(sam, id)).toHaveAttribute('data-selected', 'false');

    // TC-23 both type into the same note at once.
    const shared = await createByDoubleClick(alex, { x: 400, y: 600 });
    await alex.keyboard.type('green');
    await clickEmpty(alex);
    await expectWithin(() => textOf(sam, shared)).toBe('green');
    await editNote(alex, shared);
    await editNote(sam, shared);
    await alex.getByRole('textbox', { name: 'Note text' }).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
    await Promise.all([alex.keyboard.type('red ', { delay: 40 }), sam.keyboard.type(' blue', { delay: 40 })]);
    await expectWithin(() => textOf(alex, shared)).toBe('red green blue');
    await expectWithin(() => textOf(sam, shared)).toBe('red green blue');
    await expect(alex.getByRole('textbox', { name: 'Note text' })).toHaveValue('red green blue');
    await expect(sam.getByRole('textbox', { name: 'Note text' })).toHaveValue('red green blue');
    await clickEmpty(alex);
    await clickEmpty(sam);

    // TC-24 both drag the same note at once to different places.
    const [fromA, fromS] = [await centreOf(alex, id), await centreOf(sam, id)];
    await Promise.all([dragBy(alex, fromA, -200, 60), dragBy(sam, fromS, 150, -80)]);
    const position = async (page: Page) => {
      const n = await noteData(page, id);
      return n && `${n.x},${n.y}`;
    };
    await expectWithin(async () => (await position(alex)) === (await position(sam)), 'positions agree').toBe(true);
    await expect(noteById(alex, id)).toHaveCSS('left', (await noteById(sam, id).evaluate((el) => getComputedStyle(el).left)));

    // TC-25 Sam is typing in a note when Alex deletes it.
    await editNote(sam, shared);
    await sam.keyboard.type(' and more');
    await noteById(alex, shared).click();
    await expect(noteById(alex, shared)).toHaveAttribute('data-selected', 'true');
    await alex.keyboard.press('Delete');
    await expect(noteById(alex, shared)).toHaveCount(0);
    await expectWithin(() => noteById(sam, shared).count(), 'note gone on Sam').toBe(0);
    await expect(sam.getByRole('textbox', { name: 'Note text' })).toHaveCount(0);
    // Sam keeps working normally afterwards, and the note never comes back.
    await sam.keyboard.type('x');
    await settle(sam);
    expect(await noteData(sam, shared)).toBeUndefined();
    expect(await noteData(alex, shared)).toBeUndefined();
    for (const p of people) expect(p.errors, p.name).toEqual([]);
  });

  test('TC-25 a note deleted while someone drags it disappears and the drag ends quietly', async ({
    browser,
    browserName,
  }) => {
    test.skip(
      browserName === 'firefox',
      'Playwright Firefox stalls input to one window while another window holds a mouse button down',
    );
    ({ people } = await openParticipants(browser, ['Alex', 'Sam']));
    const [alex, sam] = people.map((p) => p.page);
    const id = await createByDoubleClick(alex, { x: 500, y: 400 });
    await clickEmpty(alex);
    await expectWithin(() => noteById(sam, id).count()).toBe(1);

    const from = await centreOf(sam, id);
    await sam.mouse.move(from.x, from.y);
    await sam.mouse.down();
    await sam.mouse.move(from.x + 40, from.y + 20, { steps: 5 });
    await expect(noteById(sam, id)).toHaveAttribute('data-state', 'dragging');

    await noteById(alex, id).click();
    await alex.getByRole('button', { name: 'Delete note' }).click();
    await expect(noteById(alex, id)).toHaveCount(0);
    await expectWithin(() => noteById(sam, id).count()).toBe(0);
    await sam.mouse.move(from.x + 120, from.y + 60, { steps: 5 });
    await sam.mouse.up();
    await settle(sam);
    expect(await notes(sam)).toEqual([]);
    expect(await notes(alex)).toEqual([]);
    for (const p of people) expect(p.errors, p.name).toEqual([]);
  });

  test('TC-28 selecting and editing a note does not change anything on the other screen', async ({ browser }) => {
    ({ people } = await openParticipants(browser, ['Alex', 'Sam']));
    const [alex, sam] = people.map((p) => p.page);
    const id = await createByDoubleClick(alex, { x: 500, y: 400 });
    await alex.keyboard.type('mine');
    await clickEmpty(alex);
    await expectWithin(() => textOf(sam, id)).toBe('mine');

    await noteById(alex, id).click();
    await expect(noteById(alex, id)).toHaveAttribute('data-selected', 'true');
    await expect(alex.getByRole('toolbar', { name: 'Note' })).toBeVisible();
    await editNote(alex, id);
    // Give any (wrong) propagation time to arrive, then check Sam's screen.
    await alex.waitForTimeout(500);
    await expect(noteById(sam, id)).toHaveAttribute('data-selected', 'false');
    await expect(noteById(sam, id)).not.toHaveAttribute('data-state', 'editing');
    await expect(sam.getByRole('textbox', { name: 'Note text' })).toHaveCount(0);
    await expect(sam.getByRole('toolbar', { name: 'Note' })).toHaveCount(0);
  });
});

test.describe('Workflow 2: full-capacity session', () => {
  test('TC-26 MAX_CONCURRENT_EDITORS people each create and move 5 notes; everyone sees everything', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `P${i + 1}`);
    const { people } = await openParticipants(browser, names);
    const ZOOM = 0.25; // notes are 50 px on screen, so 5 rows of 5 fit without overlapping
    for (const p of people) {
      await setCamera(p.page, { x: 0, y: 0, zoom: ZOOM });
      await settle(p.page);
    }

    const seenByAll = (id: string, check: (p: Page) => Promise<boolean>, by: Participant) =>
      Promise.all(people.filter((o) => o !== by).map((o) => expectWithin(() => check(o.page), `${o.name} sees ${id}`).toBe(true)));

    await Promise.all(
      people.map(async (p, row) => {
        const ids: string[] = [];
        for (let col = 0; col < 5; col++) {
          const id = await createOwn(p.page, { x: 100 + col * 150, y: 80 + row * 130 });
          await p.page.keyboard.press('Escape');
          ids.push(id);
          await seenByAll(id, async (o) => (await noteById(o, id).count()) === 1, p);
        }
        for (const id of ids) {
          await clickEmpty(p.page, { x: 1200, y: 780 });
          await dragBy(p.page, await centreOf(p.page, id), 0, 60);
          const mine = await noteData(p.page, id);
          await seenByAll(id, async (o) => (await noteData(o, id))?.y === mine!.y, p);
        }
      }),
    );

    const expected = await domSnapshot(people[0].page);
    expect(expected).toHaveLength(MAX_CONCURRENT_EDITORS * 5);
    for (const p of people) await expectWithin(() => domSnapshot(p.page), p.name).toEqual(expected);
    for (const p of people) expect(p.errors, p.name).toEqual([]);
    await closeAll(people);
  });
});

test.describe('Workflow 3: flaky Wi-Fi', () => {
  test('TC-27 edits made during an outage catch up in both directions', async ({ browser, browserName }) => {
    test.skip(browserName === 'webkit', "Playwright WebKit's offline emulation does not block WebSocket connections");
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 60_000);
    const { people } = await openParticipants(browser, ['Alex', 'Sam']);
    const [alexP, samP] = people;
    const [alex, sam] = [alexP.page, samP.page];
    await expect(connectionBadge(alex)).toHaveCount(0);

    await alexP.context.setOffline(true);
    const outageStart = Date.now();
    await expect(connectionBadge(alex)).toHaveText('Reconnecting…');
    await expect(connectionBadge(alex)).toHaveAttribute('data-state', 'reconnecting');

    // Both keep working: 3 notes each.
    for (let i = 0; i < 3; i++) {
      await createByDoubleClick(alex, { x: 200 + i * 250, y: 250 });
      await alex.keyboard.type(`alex ${i}`);
      await clickEmpty(alex);
      await createByDoubleClick(sam, { x: 200 + i * 250, y: 550 });
      await sam.keyboard.type(`sam ${i}`);
      await clickEmpty(sam);
    }
    expect(await notes(alex)).toHaveLength(3);
    expect(await notes(sam)).toHaveLength(3);

    await alex.waitForTimeout(Math.max(0, CATCH_UP_TEST_OUTAGE_MS - (Date.now() - outageStart)));
    await expect(connectionBadge(alex)).toHaveText('Reconnecting…');
    await alexP.context.setOffline(false);

    await expect(connectionBadge(alex)).toHaveText('Connected', { timeout: 15_000 });
    await expect(connectionBadge(alex)).toHaveAttribute('data-state', 'confirmed');
    await expect(connectionBadge(alex)).toHaveCount(0, { timeout: CONNECTED_CONFIRMATION_MS + 1000 });
    await waitConnected(alex);

    for (const page of [alex, sam]) await expect.poll(async () => (await notes(page)).length).toBe(6);
    const texts = (await notes(alex)).map((n) => n.text).sort();
    expect(texts).toEqual(['alex 0', 'alex 1', 'alex 2', 'sam 0', 'sam 1', 'sam 2']);
    expect(await domSnapshot(sam)).toEqual(await domSnapshot(alex));
    await expect(connectionBadge(sam)).toHaveCount(0);
    await closeAll(people);
  });
});
