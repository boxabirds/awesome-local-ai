/**
 * The room's test routes are not routes unless the server is told they are.
 *
 * `src/worker/test-hooks.ts` lets a test damage a board on purpose: overwrite its
 * snapshot, fold its log, fill it with notes, look at its rows. That is only acceptable
 * while it cannot be reached from outside a test, and the gate is one variable -
 * `TEST_HOOKS` - which is a command-line argument of the dev servers the tests start and
 * is deliberately absent from `wrangler.jsonc`. A configuration file can be read; a
 * command line has to be tested. This starts a server the way the configuration starts
 * one and asks for all five routes.
 *
 * What the routes are checked for is not only a status code: the claim is behavioural.
 * Five things are asked of a board on a server that was never given the routes - damage
 * its snapshot, fold its log, fill it with notes, put it back, look at its rows - and
 * afterwards the board is still the board, its one note still on it, its person still
 * connected. A server that has no such routes is also a server that cannot be talked into
 * using them.
 */

import { expect, type Page } from '@playwright/test';

import { test } from './fixtures.js';
import { openParticipants, closeParticipants } from './helpers/participants.js';
import {
  boardIdOf,
  createNote,
  docNotes,
  escapeEditing,
  noteCount,
  typeIntoOpenEditor,
} from './helpers/sticky.js';
import { startWrangler } from './helpers/wrangler-process.js';

/*
 * Its own server, four past the suite's dev server: the persistence tests start at +2 and
 * this file may not share a port with them. Whichever pair it gets, it is the only thing
 * that ever answered on it.
 */
const PORT = Number(process.env.E2E_PERSIST_PORT ?? 24214) + 4;

/** The five routes, including the one that only reads. */
const ROUTES = ['state', 'seed', 'compact', 'corrupt-snapshot', 'repair'] as const;

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'one server, one answer: the same question in four browsers is the same test four times',
  );
});

test('a server that was not given the test routes does not have them', async ({ browser }) => {
  test.setTimeout(240_000);
  const server = await startWrangler({ port: PORT, testHooks: false });
  try {
    // A board with something on it, so that "nothing happened" is a claim about a board
    // and not about an empty one.
    const path = await server.newBoardPath();
    const people = await openParticipants(browser, ['Alex'], server.urlFor(path));
    const page = people[0]!.page;
    const boardId = await boardIdOf(page);
    const note = await leaveANote(page);

    for (const route of ROUTES) {
      const answer = await server.hook(boardId, route, { notes: 1, textLength: 10 });
      expect(answer.status, `${route} answered`).toBe(404);
      expect(answer.json['body'], `${route} body`).toBe('not found');
      // Never the hook's own JSON: not `{"ok":true}`, and not an error that would admit
      // the board behind the address is real enough to be refused.
      expect(answer.json['ok'], `${route} reported`).toBeUndefined();
    }
    // The Worker is answering normally - it is not broken, it has no such route. A path
    // in the same namespace that this server does have gives its ordinary answer to an
    // ordinary request, which a blanket failure would not.
    const room = await fetch(server.urlFor(`/api/rooms/${boardId}`));
    expect(room.status).toBe(426);
    expect(await room.text()).toBe('expected a WebSocket upgrade');

    // And the board is the board: undamaged, unread, still connected. Someone asked for
    // five things to be done to it and there is no sign any of them were.
    expect(await docNotes(page)).toEqual([expect.objectContaining({ text: note })]);
    expect(await page.evaluate(() => window.__vidi6?.connectionState)).toBe('connected');
    expect(await noteCount(page)).toBe(1);
    await closeParticipants(people);
  } finally {
    await server.dispose();
  }
});

/** Create one note through the UI and say what it says. */
async function leaveANote(page: Page): Promise<string> {
  const text = 'the note that a stranger was not allowed to damage';
  await createNote(page);
  await typeIntoOpenEditor(page, text);
  await escapeEditing(page);
  await expect(noteCount(page)).resolves.toBe(1);
  return text;
}
