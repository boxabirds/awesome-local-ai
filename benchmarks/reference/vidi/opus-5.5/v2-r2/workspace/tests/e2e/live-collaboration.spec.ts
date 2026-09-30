import { type Page, expect, test } from '@playwright/test';
import type { StickySnapshot } from '../../src/shared/board-model';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { connectionBadge, nextFrames, setCamera } from './helpers/board';
import {
  LatencyLog,
  type Participant,
  boardState,
  closeParticipants,
  expectEventually,
  getNotes,
  openParticipants,
} from './helpers/participants';

// Mid-right: clear of the notes, the tools (left) and the zoom controls (bottom right).
const EMPTY_SPOT = { x: 1220, y: 400 };

function noteEl(page: Page, id: string) {
  return page.locator(`[data-sticky-note][data-id="${id}"]`);
}

function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Sticky note text' });
}

/** Double-clicks empty board space at `at`, types `text`, and returns the new note. */
async function createNote(page: Page, at: { x: number; y: number }, text: string): Promise<StickySnapshot> {
  await page.mouse.dblclick(at.x, at.y);
  await expect(editor(page)).toBeFocused();
  // Other people's notes may arrive meanwhile: the new note is the one being edited.
  const id = await page.locator('[data-sticky-note][data-editing="true"]').getAttribute('data-id');
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  const created = id && (await noteOn(page, id));
  if (!created) throw new Error('no note created');
  expect(created.text).toBe(text);
  return created;
}

async function clickEmpty(page: Page) {
  await page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
  await nextFrames(page);
}

async function centreOf(page: Page, id: string) {
  const box = await noteEl(page, id).boundingBox();
  if (!box) throw new Error(`note ${id} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragNote(page: Page, id: string, dx: number, dy: number, steps = 6) {
  const from = await centreOf(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps });
  await page.mouse.up();
  await nextFrames(page);
}

async function noteOn(page: Page, id: string) {
  return (await getNotes(page)).find((n) => n.id === id) ?? null;
}

async function settledState(participants: readonly Participant[]) {
  await expect
    .poll(
      async () => {
        const states = await Promise.all(participants.map(async (p) => JSON.stringify(boardState(await getNotes(p.page)))));
        return states.every((s) => s === states[0]);
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [50] },
    )
    .toBe(true);
  return boardState(await getNotes(participants[0]!.page));
}

test.describe('story 3: live collaboration', () => {
  let participants: Participant[] = [];
  const log = new LatencyLog();

  test.afterEach(async ({}, testInfo) => {
    await log.report(testInfo);
    log.samples.length = 0;
    await closeParticipants(participants);
    participants = [];
  });

  test('workflow "Two-person workshop" (TC-22 to TC-25)', async ({ browser }) => {
    participants = await openParticipants(browser, 2);
    const [alex, sam] = participants as [Participant, Participant];

    // TC-22: every kind of change reaches Sam.
    const created = await createNote(alex.page, { x: 400, y: 300 }, 'Pricing');
    await expectEventually(log, 'create + type', [sam], (p) => noteOn(p, created.id).then((n) => n?.text ?? null), 'Pricing');
    await expect(noteEl(sam.page, created.id)).toContainText('Pricing');

    await clickEmpty(alex.page);
    await dragNote(alex.page, created.id, 200, 0);
    const moved = await noteOn(alex.page, created.id);
    expect(moved!.x).toBeCloseTo(created.x + 200, 6);
    await expectEventually(log, 'move', [sam], (p) => noteOn(p, created.id).then((n) => n && { x: n.x, y: n.y }), {
      x: moved!.x,
      y: moved!.y,
    });

    await noteEl(alex.page, created.id).click();
    await alex.page.getByRole('button', { name: 'Blue colour' }).click();
    await expect(noteEl(alex.page, created.id)).toHaveAttribute('data-color', 'blue');
    await expectEventually(log, 'recolour', [sam], (p) => noteOn(p, created.id).then((n) => n?.color), 'blue');
    await expect(noteEl(sam.page, created.id)).toHaveAttribute('data-color', 'blue');

    await noteEl(alex.page, created.id).dblclick();
    await alex.page.keyboard.type('!');
    await alex.page.keyboard.press('Escape');
    await expectEventually(log, 'text', [sam], (p) => noteOn(p, created.id).then((n) => n?.text), 'Pricing!');

    await alex.page.keyboard.press('Delete');
    await expect(noteEl(alex.page, created.id)).toHaveCount(0);
    await expectEventually(log, 'delete', [sam], (p) => noteOn(p, created.id), null);
    await expect(noteEl(sam.page, created.id)).toHaveCount(0);

    // TC-23: both type into the same note at the same moment; nothing is lost.
    const shared = await createNote(alex.page, { x: 500, y: 350 }, 'green');
    await expectEventually(log, 'create', [sam], (p) => noteOn(p, shared.id).then((n) => n?.text), 'green');
    await clickEmpty(alex.page);
    await noteEl(alex.page, shared.id).dblclick();
    await noteEl(sam.page, shared.id).dblclick();
    await expect(editor(alex.page)).toBeFocused();
    await expect(editor(sam.page)).toBeFocused();
    await alex.page.keyboard.press('Home');
    await sam.page.keyboard.press('End');
    await Promise.all([
      alex.page.keyboard.type('red ', { delay: 40 }),
      sam.page.keyboard.type(' blue', { delay: 40 }),
    ]);
    for (const p of [alex, sam]) {
      await expect.poll(() => noteOn(p.page, shared.id).then((n) => n?.text), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(
        'red green blue',
      );
      await expect(editor(p.page)).toHaveValue('red green blue');
    }
    await alex.page.keyboard.press('Escape');
    await sam.page.keyboard.press('Escape');
    await clickEmpty(alex.page);
    await clickEmpty(sam.page);

    // TC-24: both drag the same note to different places at once; it settles identically.
    const dragStart = Date.now();
    await Promise.all([dragNote(alex.page, shared.id, -250, 0, 10), dragNote(sam.page, shared.id, 250, 100, 10)]);
    const finalState = await settledState(participants);
    const settledNote = finalState.find((n) => n.id === shared.id)!;
    log.record('concurrent drag (drag start → settled everywhere)', Date.now() - dragStart);
    for (const p of [alex, sam]) {
      const box = await noteEl(p.page, shared.id).boundingBox();
      expect(box).not.toBeNull();
      expect(await noteOn(p.page, shared.id)).toMatchObject({ x: settledNote.x, y: settledNote.y });
    }

    // TC-25: Sam is typing in the note when Alex deletes it.
    await noteEl(sam.page, shared.id).dblclick();
    await expect(editor(sam.page)).toBeFocused();
    await sam.page.keyboard.type(' more');
    await noteEl(alex.page, shared.id).click();
    await alex.page.keyboard.press('Delete');
    await expectEventually(log, 'delete during edit', [sam], (p) => noteOn(p, shared.id), null);
    await expect(noteEl(sam.page, shared.id)).toHaveCount(0);
    await expect(editor(sam.page)).toHaveCount(0);
    // Sam keeps typing: nothing comes back, nothing errors.
    await sam.page.keyboard.type('x');
    await sam.page.waitForTimeout(300);
    for (const p of [alex, sam]) expect(await noteOn(p.page, shared.id)).toBeNull();
    expect(alex.problems).toEqual([]);
    expect(sam.problems).toEqual([]);
  });

  test(`workflow "Full-capacity session" with MAX_CONCURRENT_EDITORS (${MAX_CONCURRENT_EDITORS}) people (TC-26)`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    participants = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    // Zoomed out so every participant's notes fit side by side.
    const zoom = 0.25;
    await Promise.all(participants.map((p) => setCamera(p.page, { x: -200, y: -200, zoom })));
    const noteScreen = STICKY_SIZE_WORLD * zoom;
    const cell = noteScreen * 2.4;

    await Promise.all(
      participants.map(async (sender, i) => {
        const others = participants.filter((p) => p !== sender);
        for (let j = 0; j < 5; j++) {
          const at = { x: 120 + j * cell, y: 80 + i * cell };
          const note = await createNote(sender.page, at, `${sender.name} ${j}`);
          await clickEmpty(sender.page);
          await expectEventually(log, `${sender.name} create ${j}`, others, (p) => noteOn(p, note.id).then((n) => n?.text ?? null), `${sender.name} ${j}`);
          await dragNote(sender.page, note.id, 0, noteScreen * 0.8);
          const moved = await noteOn(sender.page, note.id);
          await expectEventually(log, `${sender.name} move ${j}`, others, (p) => noteOn(p, note.id).then((n) => n && n.y), moved!.y);
        }
      }),
    );
    const final = await settledState(participants);
    expect(final).toHaveLength(MAX_CONCURRENT_EDITORS * 5);
    // Identical DOM on every screen.
    const dom = await Promise.all(
      participants.map((p) =>
        p.page.locator('[data-sticky-note]').evaluateAll((els) =>
          els.map((el) => `${el.getAttribute('data-id')}|${el.getAttribute('data-color')}|${(el as HTMLElement).style.left}|${(el as HTMLElement).style.top}|${el.textContent}`),
        ),
      ),
    );
    for (const d of dom) expect(d).toEqual(dom[0]);
    for (const p of participants) expect(p.problems).toEqual([]);
  });

  test('workflow "Flaky Wi-Fi": edits made during an outage catch up both ways (TC-27)', async ({ browser }) => {
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 90_000);
    participants = await openParticipants(browser, 2);
    const [alex, sam] = participants as [Participant, Participant];
    await expect(connectionBadge(alex.page)).toHaveCount(0);

    const outageStart = Date.now();
    await alex.context.setOffline(true);
    await expect(connectionBadge(alex.page)).toHaveText('Reconnecting…', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(connectionBadge(alex.page)).toHaveClass(/connection-status--reconnecting/);

    // Both keep working: 3 notes each. Alex's board stays fully editable.
    for (let i = 0; i < 3; i++) {
      await createNote(alex.page, { x: 300 + i * 250, y: 200 }, `Alex offline ${i}`);
      await clickEmpty(alex.page);
      await createNote(sam.page, { x: 300 + i * 250, y: 550 }, `Sam ${i}`);
      await clickEmpty(sam.page);
    }
    expect(await getNotes(alex.page)).toHaveLength(3);
    expect(await getNotes(sam.page)).toHaveLength(3);

    await alex.page.waitForTimeout(Math.max(0, CATCH_UP_TEST_OUTAGE_MS - (Date.now() - outageStart)));
    await expect(connectionBadge(alex.page)).toHaveText('Reconnecting…');
    await alex.context.setOffline(false);

    await expect(connectionBadge(alex.page)).toHaveText('Connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(connectionBadge(alex.page)).toHaveClass(/connection-status--confirmed/);
    const final = await settledState(participants);
    expect(final).toHaveLength(6);
    for (const p of [alex, sam]) await expect(p.page.locator('[data-sticky-note]')).toHaveCount(6);
    await expect(connectionBadge(alex.page)).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    // Sam's connection was never interrupted.
    expect(await sam.page.evaluate(() => window.__vidi6?.connectionStates?.includes('reconnecting'))).toBe(false);
  });

  test('selecting and editing stay personal (TC-28)', async ({ browser }) => {
    participants = await openParticipants(browser, 2);
    const [alex, sam] = participants as [Participant, Participant];
    const note = await createNote(alex.page, { x: 500, y: 400 }, 'Mine');
    await expectEventually(log, 'create', [sam], (p) => noteOn(p, note.id).then((n) => n?.text ?? null), 'Mine');

    await clickEmpty(alex.page);
    await noteEl(alex.page, note.id).click();
    await expect(noteEl(alex.page, note.id)).toHaveAttribute('data-selected', 'true');
    await noteEl(alex.page, note.id).dblclick();
    await expect(editor(alex.page)).toBeFocused();
    await alex.page.keyboard.type(' too');
    await expectEventually(log, 'text', [sam], (p) => noteOn(p, note.id).then((n) => n?.text), 'Mine too');

    await expect(noteEl(sam.page, note.id)).toHaveAttribute('data-selected', 'false');
    await expect(noteEl(sam.page, note.id)).toHaveAttribute('data-editing', 'false');
    await expect(editor(sam.page)).toHaveCount(0);
    await expect(sam.page.getByRole('toolbar', { name: 'Note' })).toHaveCount(0);
  });
});
