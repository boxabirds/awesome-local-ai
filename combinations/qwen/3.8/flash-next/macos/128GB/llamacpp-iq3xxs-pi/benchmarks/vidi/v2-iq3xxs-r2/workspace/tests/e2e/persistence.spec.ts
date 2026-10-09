import { expect, test } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_LOAD_BUDGET_MS, PERSIST_TESTED_NOTES } from '../../src/shared/config';
import { boardNotes } from './helpers/board';
import {
  applyChange,
  boardLink,
  closeParticipants,
  createNoteAt,
  createParticipants,
  endEditing,
  moveNoteBy,
  recolourNote,
  typeInto,
  type Participant,
} from './helpers/participants';
import { callTestHook, WranglerProcess } from './helpers/wrangler-process';

/**
 * Story 4's promise in the only place it can be proved: a real browser, a real
 * Worker, and a process that *dies*. The server here is not the shared webServer —
 * `WranglerProcess` keeps its `--persist-to` directory across a kill, which is exactly
 * the distinction the story turns on: the process forgets, the board does not.
 */
const PORT = Number(process.env.AGENT_PORT_E2E_PERSIST ?? 27428);
const server = new WranglerProcess(PORT, PORT + 1, ['TEST_HOOKS:1']);

test.beforeAll(async () => {
  await server.start('persistence');
});

test.afterAll(async () => {
  await server.stop();
  server.dispose();
});

/** Reopening a board after a process died is worth waiting a bit longer for. */
const RETURN_TIMEOUT_MS = 60_000;

test.describe('Persistence across process restarts', () => {
  test('TC-19 the overnight return: twenty-five varied notes survive a process death', async ({
    browser,
  }) => {
    const link = boardLink();
    const [alex] = await createParticipants(browser, link, 1) as [Participant];

    // Twenty-five notes, and they are not clones: some end up a different colour,
    // some get dragged about, some get typed into. Typing happens last — a note with
    // text grows downwards over its own row — and dragging only ever pulls a bottom
    // row note down into empty space, so no double-click of this test ever lands on
    // another note by accident.
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const id = await createNoteAt(alex, {
        x: 330 + (i % 5) * 180,
        y: 180 + Math.floor(i / 5) * 105,
      });
      // A double-clicked note is a note being typed into; end it before touching another.
      await endEditing(alex);
      ids.push(id);
    }
    for (const i of [0, 3, 6, 9, 12, 15, 18, 21, 24]) {
      await recolourNote(alex, ids[i]!, 'pink');
    }
    // Drags happen once nothing else is going to double-click that spot again.
    await moveNoteBy(alex, ids[7]!, { x: 25, y: -25 });
    await moveNoteBy(alex, ids[13]!, { x: -25, y: -25 });
    // Typing is last: a note with text grows downwards over its row, and by now
    // every double-click of this test has already happened.
    for (let k = 0; k < 5; k++) {
      await typeInto(alex, ids[20 + k]!, `morning note ${20 + k}`);
    }
    const before = JSON.stringify(await boardNotes(alex.page));
    await closeParticipants([alex]);

    // The night: the process stops, starts, and holds no memory of the afternoon.
    await server.restart('TC-19');

    const [returner] = await createParticipants(browser, link, 1) as [Participant];
    await expect
      .poll(async () => (await boardNotes(returner.page)).length, { timeout: RETURN_TIMEOUT_MS })
      .toBe(25);
    expect(JSON.stringify(await boardNotes(returner.page))).toBe(before);

    // And they are on screen, not merely in a document.
    await expect
      .poll(async () => returner.page.locator('[data-note-id]').count(), {
        timeout: RETURN_TIMEOUT_MS,
      })
      .toBe(25);
    await closeParticipants([returner]);
  });

  test('TC-20 leaving immediately does not leave the last change behind', async ({ browser }) => {
    const link = boardLink();
    const people = await createParticipants(browser, link, 2);
    const [alex, sam] = people as [Participant, Participant];

    // Sam seeing the note means the room stored it before broadcasting it — so the
    // moment Sam sees it is the moment the test is allowed to leave.
    await applyChange(
      'a note created seconds before the world ended',
      alex,
      async () => {
        await createNoteAt(alex, { x: 640, y: 400 });
      },
      [sam],
    );
    const seenAt = Date.now();

    await closeParticipants(people);
    const closedAt = Date.now();
    console.log(
      `[persistence] both browsers closed ${closedAt - seenAt}ms after the change was seen ` +
        `(budget 1000ms: everything they saw, they had stored)`,
    );
    expect(closedAt - seenAt).toBeLessThan(1000);

    await server.restart('TC-20');

    const [returner] = await createParticipants(browser, link, 1) as [Participant];
    await expect
      .poll(async () => (await boardNotes(returner.page)).length, { timeout: RETURN_TIMEOUT_MS })
      .toBe(1);
    await closeParticipants([returner]);
  });

  test('TC-21 a full board opens promptly', async ({ browser }) => {
    const boardId = newBoardId();
    const link = boardLink(boardId);

    // Seeded through the room's own door — every one of those notes went through
    // `store.append` like any other change, and the compaction threshold was crossed
    // on the way in, so what opens is a snapshot plus a short tail.
    const seeded = await callTestHook(server, boardId, 'seed-notes', `?count=${PERSIST_TESTED_NOTES}`);
    expect(seeded.status).toBe(200);

    const openedAt = Date.now();
    const [solo] = await createParticipants(browser, link, 1) as [Participant];
    await expect
      .poll(async () => (await boardNotes(solo.page)).length, { timeout: 120_000 })
      .toBe(PERSIST_TESTED_NOTES);
    // 'Rendered' means rendered: note elements, not document entries.
    await expect
      .poll(async () => solo.page.locator('[data-note-id]').count(), { timeout: 120_000 })
      .toBe(PERSIST_TESTED_NOTES);
    const elapsed = Date.now() - openedAt;
    console.log(
      `[load] ${PERSIST_TESTED_NOTES}-note board: ${elapsed}ms from navigation to rendered ` +
        `(budget ${BOARD_LOAD_BUDGET_MS}ms, reported not asserted)`,
    );
    await closeParticipants([solo]);
  });
});
