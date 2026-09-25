import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { boardPath, createBoard, openBoardIn, slotOf } from './helpers/boards';

/**
 * Coming back to a board (story 4, TC-19 to TC-24 in the browser).
 *
 * These are the cases the integration tests cannot make: a board that was
 * written, *left*, and then opened again by somebody with no memory of it. A
 * fresh browser context shares no localStorage and no BroadcastChannel with the
 * one that wrote the board, so anything the second page shows arrived through
 * the room's storage.
 *
 * The room is deliberately emptied of people between the write and the read:
 * that is the moment a room is most likely to lose a board (the last socket
 * closes, the checkpoint is the only write, and a few seconds later there is no
 * instance at all).
 */

interface NoteState {
  id: string;
  x: number;
  y: number;
  text: string;
}

interface Hooks {
  getNotes(): NoteState[];
  seedNote(note: { x: number; y: number; text?: string }): string;
  getBoardId(): string;
  getRoomUrl(): string | null;
  getConnectionState(): string;
}

async function notes(page: Page): Promise<NoteState[]> {
  return (
    (await page.evaluate(() => {
      const hooks = (window as unknown as { __vidi6?: Hooks }).__vidi6;
      return hooks?.getNotes();
    })) ?? []
  );
}

async function connectionState(page: Page): Promise<string> {
  return (
    (await page.evaluate(() => {
      const hooks = (window as unknown as { __vidi6?: Hooks }).__vidi6;
      return hooks?.getConnectionState();
    })) ?? 'none'
  );
}

/**
 * Since story 5 a board has to be *created* before a page can be opened on it:
 * an address nobody made is not a board, and the whole point of these tests is
 * coming back to a board that really holds something. `openBoardIn` opens one in
 * a context of its own and waits for the room's answer.
 */

/** Wait until nobody is on the board any more, and give the room a chance to write. */
async function leaveTheRoom(page: Page): Promise<void> {
  await page.waitForTimeout(1_500);
}

const shape = (list: NoteState[]): string =>
  JSON.stringify(list.map((note) => [note.id, note.x, note.y, note.text]));

test('TC-19 a board you left is the board you come back to', async ({
    browser,
    request,
  }, testInfo) => {
  const id = await createBoard(request, 'TC-19', slotOf(testInfo));
  const [writer, writerContext] = await openBoardIn(browser, boardPath(id));

  for (const [index, text] of ['retro', 'action', 'ask'].entries()) {
    await writer.evaluate((entry) => {
      const hooks = (window as unknown as { __vidi6?: Hooks }).__vidi6;
      hooks?.seedNote({ x: entry.index * 40, y: 0, text: entry.text });
    }, { index, text });
  }
  await expect.poll(() => notes(writer).then((list) => list.length)).toBe(3);
  const written = shape(await notes(writer));

  // Everybody leaves. The checkpoint on the last departure is the only thing
  // between this board and being gone.
  await leaveTheRoom(writer);
  await writerContext.close();

  // A page with no memory: fresh context, nothing cached, same address.
  const [reader, readerContext] = await openBoardIn(browser, boardPath(id));
  await expect
    .poll(() => notes(reader).then((list) => list.length), { timeout: 15_000 })
    .toBe(3);
  expect(shape(await notes(reader))).toBe(written);

  // And it is the *board*, not a copy: the note ids are the ones that were
  // written, so a returning person finds the same objects, not look-alikes.
  expect(new Set((await notes(reader)).map((note) => note.id)).size).toBe(3);

  await readerContext.close();
});

test('TC-20 a reload finds the board once, not twice', async ({ browser, request }, testInfo) => {
  const id = await createBoard(request, 'TC-20', slotOf(testInfo));
  const [first, firstContext] = await openBoardIn(browser, boardPath(id));
  await first.evaluate(() => {
    const hooks = (window as unknown as { __vidi6?: Hooks }).__vidi6;
    hooks?.seedNote({ x: 0, y: 0, text: 'once' });
  });
  await expect.poll(() => notes(first).then((list) => list.length)).toBe(1);
  await leaveTheRoom(first);

  // Reload: the document is rebuilt from scratch and handed back by the room.
  await first.reload();
  await expect.poll(() => connectionState(first), { timeout: 20_000 }).toBe('connected');
  await first.waitForTimeout(2_000);
  const after = await notes(first);
  expect(after.map((note) => note.text)).toEqual(['once']);

  await firstContext.close();
});

test('TC-21 eight people open a board that was written while nobody was there', async ({
    browser,
    request,
  }, testInfo) => {
  const id = await createBoard(request, 'TC-21', slotOf(testInfo));
  const [seedPage, seedContext] = await openBoardIn(browser, boardPath(id));
  await seedPage.evaluate(() => {
    const hooks = (window as unknown as { __vidi6?: Hooks }).__vidi6;
    hooks?.seedNote({ x: 0, y: 0, text: 'seed' });
  });
  await expect.poll(() => notes(seedPage).then((list) => list.length)).toBe(1);
  await leaveTheRoom(seedPage);
  await seedContext.close();

  // Eight restart candidates at once, none of them aware of the others.
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  for (let index = 0; index < 8; index += 1) {
    const [page, context] = await openBoardIn(browser, boardPath(id));
    contexts.push(context);
    pages.push(page);
  }

  for (const page of pages) {
    await expect
      .poll(() => notes(page).then((list) => list.length), { timeout: 20_000 })
      .toBe(1);
  }
  // One board, eight copies of it: the same shape everywhere, which is what
  // "one read, then everybody is answered from it" has to look like.
  const shapes = new Set<string>();
  for (const page of pages) shapes.add(shape(await notes(page)));
  expect(shapes.size).toBe(1);

  // A change made now still travels: the room is serving these people, not
  // just remembering a board.
  await pages[0]!.evaluate(() => {
    const hooks = (window as unknown as { __vidi6?: Hooks }).__vidi6;
    hooks?.seedNote({ x: 200, y: 0, text: 'late' });
  });
  for (const page of pages.slice(1)) {
    await expect
      .poll(() => notes(page).then((list) => list.map((note) => note.text).includes('late')), {
        timeout: 15_000,
      })
      .toBe(true);
  }

  for (const context of contexts) await context.close();
});
