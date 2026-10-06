/**
 * Story 5 e2e workflows (`share.board_api`, `share.pages`, `share.share_panel`)
 * — TC-26 to TC-29, TC-31.
 *
 * These run against a real `wrangler dev` serving the real client build, because
 * the story is about a *link*: it has to survive a browser, a server, a socket
 * and a clipboard at the same time. Functional outcomes are waited for with
 * `expectEventually`; wall-clock budgets (creation time) are logged, not asserted
 * — see the design's "not asserted" note.
 */

import { expect, test, type Page } from "@playwright/test";
import { BOARD_ID_PATTERN, isValidBoardId, newBoardId } from "../../src/shared/board-id";
import { CREATE_BUDGET_MS, LINK_COPIED_MS } from "../../src/shared/config";
import * as board from "./helpers/board";
import * as notes from "./helpers/notes";
import { boardStatus, createBoard, seedLegacyBoard } from "./helpers/api";
import { expectEventually, instrumentSockets, reportLatencies, socketCount } from "./helpers/participants";
import { retroBoard } from "../fixtures/boards";

const NOT_FOUND = "[data-testid='not-found-page']";
const BOARD_VIEWPORT = "[data-testid='board-viewport']";

/** `/b/<id>` for a board that exists: the address a person would be given. */
function boardLink(page: Page, boardId: string): string {
  return new URL(`/b/${boardId}`, page.url()).href;
}

async function noteIds(page: Page): Promise<string[]> {
  return (await notes.notes(page)).map((note) => note.id);
}

test.afterEach(() => {
  const report = reportLatencies();
  if (report.count > 0) {
    console.log(
      `[share latency report] n=${report.count} p50=${report.p50}ms p95=${report.p95}ms max=${report.max}ms`,
    );
  }
});

test.describe("TC-26 workflow: create, share, join", () => {
  test("one person's link is another person's board, and both keep editing it", async ({ browser }) => {
    test.skip(
      !test.info().project.name.includes("chromium"),
      "reading the clipboard back needs clipboard-read permission, which only Chromium grants",
    );

    const mayaContext = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const maya = await mayaContext.newPage();
    await instrumentSockets(maya);
    maya.on("pageerror", (error) => {
      throw new Error(`Maya's page threw: ${error.message}`);
    });

    // `/` is a page, not a board: story 5 removed the old "any visit is a board"
    // behaviour, so the home page must show no board at all.
    await maya.goto("/");
    await expect(maya.getByTestId("home-page")).toBeVisible();
    await expect(maya.getByTestId("new-board-button")).toBeVisible();
    await expect(maya.locator(BOARD_VIEWPORT)).toHaveCount(0);
    await expect(maya.getByTestId("share-button")).toHaveCount(0);
    expect(await socketCount(maya)).toBe(0);

    // Creating a board is one click and one POST; the time is measured, not judged.
    const startedAt = Date.now();
    await maya.click("[data-testid='new-board-button']");
    await expect(maya.getByTestId("board-viewport")).toBeVisible();
    const clickToBoardMs = Date.now() - startedAt;
    console.log(
      `TC-26 click to board: ${clickToBoardMs}ms (budget CREATE_BUDGET_MS=${CREATE_BUDGET_MS}ms, logged not asserted)`,
    );

    // The address is a board link, and it is the board Maya is looking at.
    const boardId = new URL(maya.url()).pathname.slice("/b/".length);
    expect(maya.url()).toContain(`/b/${boardId}`);
    expect(boardId).toMatch(BOARD_ID_PATTERN);
    expect(isValidBoardId(boardId)).toBe(true);
    expect(boardId).toHaveLength(22);

    // A new board is empty.
    expect(await notes.noteCount(maya)).toBe(0);

    const noteId = await createNote(maya, "Design review");
    expect(await notes.noteCount(maya)).toBe(1);

    // Share panel: open, copy, confirmation, and the link the clipboard now holds.
    await maya.click("[data-testid='share-button']");
    const panel = maya.getByTestId("share-panel");
    await expect(panel).toBeVisible();
    await expect(maya.getByTestId("share-link-input")).toHaveValue(boardLink(maya, boardId));

    await maya.click("[data-testid='copy-link-button']");
    await expect(maya.getByTestId("link-copied")).toBeVisible();

    const copied = await maya.evaluate(async () => await navigator.clipboard.readText());
    expect(copied, "the clipboard holds exactly the board link").toBe(boardLink(maya, boardId));
    // Negative half (TC-22/TC-26): nothing is attached to the link.
    expect(new URL(copied).pathname).toBe(`/b/${boardId}`);
    expect(new URL(copied).search).toBe("");
    expect(copied).toBe(copied.trim());
    expect(copied).not.toContain("<");

    // Confirmation is temporary; the board is not.
    await expect(maya.getByTestId("link-copied")).toHaveCount(0, { timeout: LINK_COPIED_MS + 4_000 });
    await expect(maya.getByTestId("board-viewport")).toBeVisible();

    // Sam joins through the link Maya copied — a different context, so nothing is
    // shared except the address.
    const samContext = await browser.newContext();
    const samPage = await samContext.newPage();
    await instrumentSockets(samPage);
    await samPage.goto(copied);
    await expect(samPage.getByTestId("board-viewport")).toBeVisible();
    expect(new URL(samPage.url()).pathname).toBe(`/b/${boardId}`);

    await expectEventually("TC-26 Maya's note reaches Sam", async () => (await noteIds(samPage)).includes(noteId));
    await expectEventually("TC-26 the note's text reaches Sam", async () => {
      const note = (await notes.notes(samPage)).find((entry) => entry.id === noteId);
      return note?.text === "Design review";
    });

    // Sam edits it: a move Sam makes must arrive on Maya's board.
    const samNote = (await notes.notes(samPage)).find((entry) => entry.id === noteId)!;
    const from = notes.centreOf(samNote);
    await notes.dragOnBoard(samPage, from, 160, 120);

    await expectEventually("TC-26 Sam's edit reaches Maya", async () => {
      const mayaNote = (await notes.notes(maya)).find((entry) => entry.id === noteId);
      if (!mayaNote) return false;
      const centre = notes.centreOf(mayaNote);
      return Math.abs(centre.x - from.x - 160) < 6 && Math.abs(centre.y - from.y - 120) < 6;
    });

    // Negative half: the two participants share one board, not two look-alikes.
    expect(await boardStatus(boardId)).toBe(200);
    const other = newBoardId();
    expect(other).not.toBe(boardId);
    expect(await boardStatus(other)).toBe(404);
    await expect(maya.locator(NOT_FOUND)).toHaveCount(0);

    await samContext.close();
    await mayaContext.close();
  });

  test("TC-15 negative: two New board clicks give two different boards", async ({ page }) => {
    await page.goto("/");

    await page.click("[data-testid='new-board-button']");
    await expect(page.getByTestId("board-viewport")).toBeVisible();
    const first = new URL(page.url()).pathname;

    await page.goto("/");
    await page.click("[data-testid='new-board-button']");
    await expect(page.getByTestId("board-viewport")).toBeVisible();
    const second = new URL(page.url()).pathname;

    expect(second).not.toBe(first);
    expect(second).toMatch(/^\/b\/[A-Za-z0-9_-]{22}$/);
    // Both exist, and neither is the other.
    expect(await boardStatus(second.slice(3))).toBe(200);
  });
});

test.describe("TC-27 workflow: bad link recovery", () => {
  test("a link to a board that was never created says Board not found, and New board starts one", async ({
    page,
  }) => {
    await instrumentSockets(page);
    const boardId = newBoardId(); // never created, on purpose

    await page.goto(`/b/${boardId}`);

    await expect(page.locator(NOT_FOUND)).toBeVisible();
    await expect(page.getByTestId("board-address")).toHaveText(`/b/${boardId}`);
    await expect(page.getByTestId("new-board-button")).toBeVisible();
    await expect(page.locator(BOARD_VIEWPORT)).toHaveCount(0);
    await expect(page.getByTestId("share-button")).toHaveCount(0);

    // Negative halves: asking about a board must not open a board socket, and must
    // not create the board either.
    expect(await socketCount(page)).toBe(0);
    expect(await boardStatus(boardId)).toBe(404);

    await page.click("[data-testid='new-board-button']");
    await expect(page.getByTestId("board-viewport")).toBeVisible();

    const created = new URL(page.url()).pathname.slice("/b/".length);
    expect(created).not.toBe(boardId);
    expect(created).toMatch(BOARD_ID_PATTERN);
    expect(await notes.noteCount(page)).toBe(0);
    expect(await boardStatus(created)).toBe(200);
  });

  test("malformed board addresses are never treated as boards (no request, no board)", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/")) requests.push(new URL(request.url()).pathname);
    });
    await instrumentSockets(page);

    for (const path of ["/b/bad", "/b/", "/b/short", "/b/not-an-id!", "/boards", "/join/room"]) {
      await page.goto(path);
      await expect(page.locator(NOT_FOUND), path).toBeVisible();
      await expect(page.getByTestId("board-address"), path).toHaveText(path);
      await expect(page.locator(BOARD_VIEWPORT), path).toHaveCount(0);
    }

    // Negative half (TC-19 mirrored in the browser): a malformed address is not
    // worth a request, and no board socket is opened for it.
    expect(requests.filter((entry) => entry.startsWith("/api/boards/"))).toEqual([]);
    expect(requests.filter((entry) => entry.startsWith("/api/rooms/"))).toEqual([]);
    expect(await socketCount(page)).toBe(0);
  });

  test("an unknown link cannot be confused with an empty board by a reload", async ({ page }) => {
    const boardId = newBoardId();
    await page.goto(`/b/${boardId}`);
    await expect(page.locator(NOT_FOUND)).toBeVisible();

    await page.reload();
    await expect(page.locator(NOT_FOUND)).toBeVisible();
    await expect(page.locator(BOARD_VIEWPORT)).toHaveCount(0);
  });
});

test.describe("TC-28 workflow: flaky service on open", () => {
  test("a board the server cannot be asked about says so, then opens when the route is restored", async ({
    page,
  }) => {
    const boardId = await createBoard();

    // Block the existence check the way a dead server would: refuse the request.
    await page.route("**/api/boards/*", (route) => route.abort("connectionrefused"));

    // A marker that only survives if the page is never reloaded: TC-28 is about
    // the board arriving *without* a reload.
    await page.addInitScript(() => {
      (window as unknown as { __vidi6NoReload?: number }).__vidi6NoReload = 1;
    });

    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId("board-page")).toHaveAttribute("data-board-status", "unreachable");
    await expect(page.getByTestId("board-page")).toContainText("Couldn’t reach vidi6. Retrying…");
    await expect(page.locator(BOARD_VIEWPORT)).toHaveCount(0);

    await page.unroute("**/api/boards/*");

    await expect(page.getByTestId("board-viewport")).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => (window as unknown as { __vidi6NoReload?: number }).__vidi6NoReload)).toBe(1);
    expect(new URL(page.url()).pathname).toBe(`/b/${boardId}`);
  });

  test("an outage is never shown as 'Board not found'", async ({ page }) => {
    const boardId = await createBoard();
    await page.route("**/api/boards/*", (route) => route.abort("connectionrefused"));
    await page.goto(`/b/${boardId}`);

    await expect(page.getByTestId("board-page")).toHaveAttribute("data-board-status", "unreachable");
    await expect(page.locator(NOT_FOUND)).toHaveCount(0);

    // Even after several retries, an outage still is not "not found".
    await page.waitForTimeout(4_000);
    await expect(page.locator(BOARD_VIEWPORT)).toHaveCount(0);
    await expect(page.locator(NOT_FOUND)).toHaveCount(0);
    const status = await page.getByTestId("board-page").getAttribute("data-board-status");
    expect(status === "unreachable" || status === "checking").toBe(true);

    await page.unroute("**/api/boards/*");
  });
});

test.describe("TC-29 workflow: clipboard blocked", () => {
  test("when the clipboard refuses, the link is selected so it can be copied by hand", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new Error("clipboard denied by the browser")),
        },
      });
    });
    const page = await context.newPage();

    const boardId = await board.openBoard(page);
    await page.click("[data-testid='share-button']");
    await page.click("[data-testid='copy-link-button']");

    await expect(page.getByTestId("copy-fallback")).toBeVisible();
    await expect(page.getByTestId("copy-fallback")).toHaveText("Press Ctrl+C (Cmd+C on Mac) to copy");
    await expect(page.getByTestId("link-copied")).toHaveCount(0);

    // The link is not merely on screen: it is selected, so Ctrl+C is enough.
    const selection = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>("[data-testid='share-link-input']");
      if (!input) throw new Error("the share link input is missing");
      return {
        value: input.value,
        start: input.selectionStart,
        end: input.selectionEnd,
        focused: document.activeElement === input,
      };
    });
    expect(selection.value).toBe(boardLink(page, boardId));
    expect(selection.start).toBe(0);
    expect(selection.end).toBe(selection.value.length);
    expect(selection.focused).toBe(true);

    // The board itself is untouched by a clipboard that refuses.
    await expect(page.getByTestId("board-viewport")).toBeVisible();

    await context.close();
  });
});

test.describe("TC-31 workflow: pre-existing (legacy) board", () => {
  test("a board with content and no created_at still opens", async ({ page }) => {
    const boardId = newBoardId();
    const fixture = retroBoard(12);

    // Written the way story 4 left old boards: `updates` rows, no `created_at`.
    // Only the test-only hook can do this — the product no longer can.
    await seedLegacyBoard(boardId, fixture.updates);

    // The server's existence rule counts such a board as existing.
    expect(await boardStatus(boardId)).toBe(200);

    await board.openBoardLink(page, boardId);

    await expect(page.locator(NOT_FOUND)).toHaveCount(0);
    await expect(page.getByTestId("board-viewport")).toBeVisible();

    // The seeded notes are on the board, with the ids they were written with.
    const seededIds = fixture.notes.map((note) => note.id);
    await expectEventually("TC-31 the legacy board's notes arrive", async () => {
      const onBoard = await noteIds(page);
      return seededIds.every((id) => onBoard.includes(id));
    });
    expect(await notes.noteCount(page)).toBe(fixture.notes.length);

    // And the board is shareable like any other.
    await page.click("[data-testid='share-button']");
    await expect(page.getByTestId("share-link-input")).toHaveValue(boardLink(page, boardId));
  });

  test("negative: a legacy-shaped board that was never written is still not found", async ({ page }) => {
    const neverWritten = newBoardId();
    expect(await boardStatus(neverWritten)).toBe(404);
    await page.goto(`/b/${neverWritten}`);
    await expect(page.locator(NOT_FOUND)).toBeVisible();
  });
});

/** Creates a note by double-click, types into it, and returns its id. */
async function createNote(page: Page, text: string): Promise<string> {
  const before = new Set(await noteIds(page));
  const centre = await board.boardCentre(page);
  await notes.createNoteByDoubleClick(page, centre);
  await page.keyboard.type(text);
  await notes.endEditing(page);

  const created = (await notes.notes(page)).find((note) => !before.has(note.id));
  if (!created) throw new Error("the new note is missing");
  return created.id;
}
