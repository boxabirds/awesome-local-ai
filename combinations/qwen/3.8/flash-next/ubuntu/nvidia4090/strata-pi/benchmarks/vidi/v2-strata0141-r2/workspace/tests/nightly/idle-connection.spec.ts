import { expect, test } from '@playwright/test';
import { NIGHTLY_IDLE_MS } from '../../src/shared/config';
import {
  assertQuietAfterLeavingBoard,
  badgeText,
  closeSession,
  connectionAttempts,
  connectionLog,
  createNote,
  deliver,
  expectNoConsoleErrors,
  openBoardTogether,
  person,
  waitForConnected,
  hasNote,
} from '../e2e/helpers/participants';

/** How often the badge is sampled during the idle period. */
const SAMPLE_MS = 3_000;

/**
 * TC-29 — an idle board keeps its connection.
 *
 * Nothing is typed, dragged or clicked for `NIGHTLY_IDLE_MS`. The room relays
 * awareness to every socket including the sender, so even a board nobody touches
 * keeps receiving traffic, and y-websocket's silence timeout never fires.
 */
test.describe('idle connection stability (TC-29)', () => {
  test('two screens sit idle without ever reporting a lost connection', async ({ browser }) => {
    test.setTimeout(NIGHTLY_IDLE_MS + 120_000);
    const session = await openBoardTogether(browser, ['Alex', 'Sam']);
    const alex = person(session, 0);
    const sam = person(session, 1);

    try {
      await waitForConnected(alex);
      await waitForConnected(sam);

      const badges: string[] = [];
      for (let waited = 0; waited < NIGHTLY_IDLE_MS; waited += SAMPLE_MS) {
        await alex.page.waitForTimeout(SAMPLE_MS);
        badges.push((await badgeText(alex.page)) ?? '');
        badges.push((await badgeText(sam.page)) ?? '');
      }

      // The badge never said "Reconnecting…" while nobody was doing anything.
      expect(
        badges.filter((text) => text.includes('Reconnecting')),
        `badge samples across ${NIGHTLY_IDLE_MS / 1000}s of idleness`,
      ).toEqual([]);

      for (const participant of [alex, sam]) {
        const states = await connectionLog(participant.page);
        expect(states[0], `${participant.name} connection states`).toBe('connecting');
        expect(
          states.filter((state) => state === 'reconnecting'),
          `${participant.name} connection states during the idle period`,
        ).toEqual([]);

        // After the first "connected", only connected and its confirmation follow.
        const first = states.indexOf('connected');
        expect(first, `${participant.name} never reported being connected`).toBeGreaterThanOrEqual(0);
        expect(
          states.slice(first).filter((state) => state !== 'connected' && state !== 'confirmed'),
          `${participant.name} left the connected state`,
        ).toEqual([]);

        // One socket for the whole idle period: no dropped-and-redialled connection.
        const attempts = await connectionAttempts(participant.page);
        expect(attempts.length, `${participant.name} dialled the room more than once`).toBe(1);
      }

      // The idle connection is not a zombie: a change still travels it.
      let noteId = '';
      await deliver(
        'TC-29 change after 45s idle',
        async () => {
          noteId = await createNote(alex.page, { x: 400, y: 300 });
        },
        async () => await hasNote(sam.page, noteId),
      );

      expectNoConsoleErrors(alex, sam);

      // Leaving the board shuts the provider down; nothing dials afterwards.
      await Promise.all([assertQuietAfterLeavingBoard(alex), assertQuietAfterLeavingBoard(sam)]);
    } finally {
      await closeSession(session);
    }
  });
});
