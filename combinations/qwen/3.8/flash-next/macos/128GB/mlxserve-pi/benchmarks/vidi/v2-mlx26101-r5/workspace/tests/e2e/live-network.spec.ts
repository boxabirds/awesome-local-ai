/**
 * A board while one person's network is not working.
 *
 * Two things have to be true. While the network is down, the person on the other end must
 * not be told everything is fine — the board has to say it is reconnecting rather than
 * quietly holding a stale picture. And when the network comes back, both browsers must end
 * up with everything: the notes made while offline go up to the room, the notes made in the
 * room come down, and nothing is duplicated or lost.
 *
 * A browser takes itself offline with `context.setOffline`, which is the closest thing here
 * to a Wi-Fi doing a Wi-Fi. It stalls the socket rather than closing it, which is exactly
 * what a flaky connection does — and it is why the board has a keepalive: the browser
 * notices the silence, and the test measures how long the silence lasted.
 */

import { expect, test } from '@playwright/test';

import { CATCH_UP_TEST_OUTAGE_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { doubleClickCreate, noteIds, noteText, editorLocator } from './helpers/board';
import {
  badge,
  badgeText,
  boardAddress,
  canReachServer,
  openParticipant,
  openPersonPage,
  closeParticipants,
  connectionState,
  EVENTUAL_TIMEOUT_MS,
  expectEventually,
  expectNoConsoleErrors,
  expectSameBoard,
  latencyReport,
  latencySamples,
  newBoard,
  OFFLINE_CONSOLE_NOISE,
  OFFLINE_DETECTION_TIMEOUT_MS,
  openParticipants,
  resetLatencySamples,
  stopEditing,
  writeLatencyReport,
  type Participant,
} from './helpers/participants';

/** The notes one person makes, at their own spots, with their words in them. */
async function makeNotes(person: Participant, words: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, word] of words.entries()) {
    const id = await doubleClickCreate(person.page, 240 + index * 240, 320);
    ids.push(id);
    await person.page.keyboard.type(word);
    await stopEditing(person.page);
  }
  return ids;
}

/** Every one of `words` is readable on this person's board. */
async function canRead(person: Participant, words: readonly string[]): Promise<boolean> {
  const texts = await person.page.locator('.sticky-text').allInnerTexts();
  return words.every((word) => texts.includes(word));
}

test('TC-27 a person who drops off comes back with everything', async ({ browser }, testInfo) => {
  // This test spends most of its life waiting for a network to fail, which takes as long as
  // the connection's own keepalive takes to notice.
  test.setTimeout(300_000);
  resetLatencySamples();
  const boardId = newBoard();
  const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam'], boardId);
  const alexWords = ['made while offline 1', 'made while offline 2', 'made while offline 3'];
  const samWords = ['made in the room 1', 'made in the room 2', 'made in the room 3'];

  // Alex's connection goes. The page does not change yet, and that is correct: a socket that
  // has stopped answering has not closed, and nothing on the board says it has.
  const outageStarted = Date.now();
  await alex.context.setOffline(true);

  // Both of them carry on working. Alex's notes have nowhere to go; Sam's sit in the room.
  const alexIds = await makeNotes(alex, alexWords);
  const samIds = await makeNotes(sam, samWords);

  // Alex's own board still holds what Alex did — offline does not mean broken.
  expect(await noteIds(alex.page)).toHaveLength(alexWords.length);
  expect(await canRead(alex, alexWords), 'Alex has not lost their own typing').toBe(true);
  // And Sam's notes have not arrived, because they could not have.
  expect(await canRead(alex, samWords), 'nothing arrives while Alex is offline').toBe(false);

  // Now the board admits it cannot reach anybody. The bound on this is the connection's own
  // keepalive (it gives up on a socket it has heard nothing from) plus its reconnect backoff.
  const noticedIn = await expectEventually(
    alex,
    'the badge to say it is reconnecting',
    () => badgeText(alex.page).then((text) => text === 'Reconnecting…'),
    { timeoutMs: OFFLINE_DETECTION_TIMEOUT_MS, record: false },
  );
  expect(await connectionState(alex.page)).toBe('reconnecting');
  expect(
    await badge(alex.page).getAttribute('data-state'),
    'the badge says what the board thinks',
  ).toBe('reconnecting');
  // The premise, checked rather than assumed: Alex's browser really cannot reach the server,
  // and Sam's really can.
  expect(await canReachServer(alex.page), 'Alex is offline in the browser, not just in name').toBe(false);
  expect(await canReachServer(sam.page), 'Sam was never affected').toBe(true);

  // Sam keeps working and is told nothing is wrong: Sam's board is connected, and Alex's
  // notes have not reached it because they could not have.
  expect(await canRead(sam, alexWords), 'Alex’s offline notes did not leak into the room').toBe(false);
  expect(await badgeText(sam.page), 'Sam was never told anything was wrong').toBeNull();

  // However long that took, the outage is at least the 30 seconds the story is about.
  const outageSoFar = Date.now() - outageStarted;
  if (outageSoFar < CATCH_UP_TEST_OUTAGE_MS) {
    await sam.page.waitForTimeout(CATCH_UP_TEST_OUTAGE_MS - outageSoFar);
  }

  // The network comes back. The catch-up is not a reload — the page was never reloaded, and
  // it is the board's job to make itself current.
  const backOnlineAt = Date.now();
  await alex.context.setOffline(false);

  // Coming back is bounded the same way going away is: the board cannot know the network is
  // there until an attempt gets an answer.
  const backIn = await expectEventually(
    alex,
    'the badge to go away again',
    async () => (await badgeText(alex.page)) === null && (await connectionState(alex.page)) === 'connected',
    { timeoutMs: OFFLINE_DETECTION_TIMEOUT_MS, record: false },
  );
  console.info(
    `   Alex was back in the room ${Math.round(backIn / 1000)}s after the network came back (allowed ${Math.round(OFFLINE_DETECTION_TIMEOUT_MS / 1000)}s)`,
  );

  // Both directions, on both screens, without anybody doing anything.
  await expectEventually(alex, 'the notes Sam made in the room', () =>
    noteIds(alex.page).then((ids) => ids.length === alexWords.length + samWords.length),
  );
  const catchUpIn = Date.now() - backOnlineAt;
  await expectEventually(sam, 'the notes Alex made while offline', () =>
    noteIds(sam.page).then((ids) => ids.length === alexWords.length + samWords.length),
  );

  for (const person of [alex, sam]) {
    expect(await canRead(person, alexWords), `${person.name} has Alex’s notes`).toBe(true);
    expect(await canRead(person, samWords), `${person.name} has Sam’s notes`).toBe(true);
    const ids = await noteIds(person.page);
    expect(new Set(ids).size, `${person.name} has no duplicates`).toBe(6);
    expect([...ids].sort()).toEqual([...alexIds, ...samIds].sort());
  }
  // Text is intact in both directions, not just the note objects.
  for (const [id, word] of [...alexIds.map((note, index) => [note, alexWords[index]]), ...samIds.map((note, index) => [note, samWords[index]])]) {
    expect(await noteText(alex.page, id as string)).toBe(word as string);
    expect(await noteText(sam.page, id as string)).toBe(word as string);
  }

  await expectSameBoard([alex, sam], 'one board, after an outage', 30_000);
  // Nothing was thrown while the network fell over and came back, on either side — apart from
  // the messages Alex's browser makes about having no network, which are this test's premise.
  expectNoConsoleErrors([sam]);
  // Alex's browser tried to dial a room it had no network for, and says so; nothing else.
  expectNoConsoleErrors([alex], [OFFLINE_CONSOLE_NOISE]);
  expect(await editorLocator(alex.page).count()).toBe(0);

  const report =
    `offline for ${Math.round((Date.now() - outageStarted) / 1000)}s; ` +
    `Alex noticed the drop after ${noticedIn}ms (bound ${OFFLINE_DETECTION_TIMEOUT_MS}ms); ` +
    `both boards agreed ${catchUpIn}ms after Alex came back; ${latencyReport(latencySamples())}`;
  testInfo.annotations.push({ type: 'offline catch-up', description: report });
  console.info(report);
  await writeLatencyReport(testInfo, 'tc-27-catch-up');
  await closeParticipants([alex, sam]);
});

test('a room that cannot be reached says so, and the person can keep working', async ({
  browser,
}, testInfo) => {
  // The other half of the promise: while the room cannot be reached, the board does not
  // pretend to be shared, the person is not stopped from typing, and the work gets to the
  // room by itself once the room can be reached — without a reload.
  test.setTimeout(180_000);
  resetLatencySamples();
  const boardId = newBoard();
  const alex = await openPersonPage(browser, 'Alex');

  // The room is unreachable: every attempt to dial it is turned away, while the page itself
  // loads normally. This is a room that is down, not a browser that is offline.
  let reachable = false;
  await alex.context.routeWebSocket(/\/api\/rooms\//, (socket) => {
    if (reachable) {
      const room = socket.connectToServer();
      room.onMessage((message) => socket.send(message));
      socket.onMessage((message) => room.send(message));
      return;
    }
    socket.close({ code: 1011, reason: 'no route to the room' });
  });
  await alex.page.goto(boardAddress(boardId));

  // The board opens anyway and keeps saying it is trying to get in.
  await expect(alex.page.getByTestId('app')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  const status = alex.page.getByTestId('connection-status');
  await expect(status).toBeVisible();
  await expect(status).toHaveText('Connecting…');
  await alex.page.waitForTimeout(8_000); // longer than a reconnect cycle
  expect(await badgeText(alex.page), 'never claims to be connected').not.toBeNull();
  expect(await connectionState(alex.page)).not.toBe('connected');

  // The person can still make a note and type in it.
  const id = await doubleClickCreate(alex.page, 400, 300);
  await alex.page.keyboard.type('written with no room');
  await alex.page.keyboard.press('Escape');
  await expect(alex.page.locator('.sticky-editor')).toHaveCount(0);
  expect(await noteText(alex.page, id)).toBe('written with no room');

  // The room comes back. The board gets itself in, on its own, and what was typed while it
  // was away is now in the room for anybody who opens the board.
  reachable = true;
  await expectEventually(
    alex,
    'the board to get itself into the room',
    async () => (await badgeText(alex.page)) === null && (await connectionState(alex.page)) === 'connected',
    { timeoutMs: 6 * EVENTUAL_TIMEOUT_MS, record: false },
  );

  const sam = await openParticipant(browser, 'Sam', boardId);
  await expectEventually(sam, 'what Alex typed while the room was down', () =>
    canRead(sam, ['written with no room']),
  );
  expect(await noteIds(alex.page)).toEqual(await noteIds(sam.page));

  // Nothing was thrown anywhere on the way through.
  expectNoConsoleErrors([sam]);
  expectNoConsoleErrors([alex], [OFFLINE_CONSOLE_NOISE]);
  await writeLatencyReport(testInfo, 'room-unreachable');
  await closeParticipants([alex, sam]);
});
