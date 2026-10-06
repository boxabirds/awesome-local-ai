/**
 * Boards, from outside the browser.
 *
 * Since story 5 a board is a thing the service has to have made, and a test that drives a browser
 * at an address the service has never heard of gets "Board not found" — correctly. So a test that
 * wants a board asks for one first, from Node, the way the home page asks from a page:
 * `POST /api/boards`.
 *
 * Two ways of making a board exist, and the difference is which story a test belongs to:
 *
 *   `createBoard` is the real one. It returns the id, because only the service makes them, and it
 *       is what a test that cares about links and creation should use.
 *   `ensureBoard` is for the tests that pre-date links (stories 1 to 4) and choose their own board
 *       id so that several browsers can be pointed at one board. It asks that id to exist, by the
 *       same call to the same object `POST /api/boards` makes — a test hook, which is only routed
 *       when the server is built for tests. Nothing about the board's behaviour differs: a board
 *       made this way is a board.
 *
 * `seedLegacyBoard` is a third thing, and the only way to have a board that predates the API:
 * content written straight to the board's storage, with no record of ever having been created.
 */

import { expect } from '@playwright/test';
import * as Y from 'yjs';

import { createSticky, initDoc } from '../../../src/shared/board-model';
import type { StickyColor } from '../../../src/shared/config';

/** Where the suite's server answers, as `playwright.config.ts` and `e2e:serve` both say. */
export const DEFAULT_ORIGIN = `http://127.0.0.1:${Number(process.env.VIDI6_E2E_PORT ?? 20784)}`;

/** The board's address, as a person is given it. */
export function boardAddress(boardId: string, origin: string = DEFAULT_ORIGIN): string {
  return `${origin}/b/${boardId}`;
}

/** Asks the service for a board, and takes its id. */
export async function createBoard(origin: string = DEFAULT_ORIGIN): Promise<string> {
  const response = await fetch(`${origin}/api/boards`, { method: 'POST' });
  const body: unknown = await response.json().catch(() => null);
  const id = typeof body === 'object' && body !== null ? (body as { id?: unknown }).id : undefined;
  expect(response.status, `creating a board answered ${String(response.status)}`).toBe(201);
  expect(typeof id, 'the answer did not name a board').toBe('string');
  return id as string;
}

/** What the service says about a link: the status, and nothing else. */
export async function boardStatus(
  boardId: string,
  origin: string = DEFAULT_ORIGIN,
): Promise<number> {
  return (await fetch(`${origin}/api/boards/${boardId}`)).status;
}

/**
 * Makes a board exist under a chosen id, for tests that need to know the id before the service
 * does — which is every test that puts two browsers on one board and was written before links.
 */
export async function ensureBoard(boardId: string, origin: string = DEFAULT_ORIGIN): Promise<void> {
  const response = await fetch(`${origin}/__test/boards/${boardId}/initialize`, { method: 'POST' });
  expect(
    response.status,
    `could not make board ${boardId} exist (${String(response.status)}); the server needs --var TEST_HOOKS:1`,
  ).toBe(200);
}

/**
 * Puts a board that predates links on the server: real notes, written as the log rows a board that
 * had been edited would have written, and no `created_at` — which is the whole of what "predates
 * links" means to the service, and the reason it has to count such a board as existing.
 *
 * Returns how many notes are on it, so the test can say what it expects to see rather than repeat
 * a number it wrote twice.
 */
export async function seedLegacyBoard(
  boardId: string,
  notes: readonly { x: number; y: number; color?: StickyColor }[],
  origin: string = DEFAULT_ORIGIN,
): Promise<number> {
  const doc = new Y.Doc();
  initDoc(doc);
  for (const note of notes) createSticky(doc, { x: note.x, y: note.y }, note.color);
  const update = Y.encodeStateAsUpdate(doc);

  const response = await fetch(`${origin}/__test/boards/${boardId}/seed-legacy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ updates: [Buffer.from(update).toString('base64')] }),
  });
  expect(response.status, `seeding a legacy board answered ${String(response.status)}`).toBe(200);
  return notes.length;
}

/** The same address as a room connection, for a test that wants to talk to the room itself. */
export const DEFAULT_WS_ORIGIN = DEFAULT_ORIGIN.replace(/^http/, 'ws');
