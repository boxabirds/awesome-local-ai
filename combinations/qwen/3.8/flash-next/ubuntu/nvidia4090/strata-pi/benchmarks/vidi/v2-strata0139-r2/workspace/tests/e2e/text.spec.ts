import { expect, test, type Page } from "@playwright/test";
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from "../../src/shared/config";
import { snapshot, type ObjectSnapshot } from "../../src/shared/board-model";
import { openSyncClient } from "./helpers/sync-client";
import { E2E_PORT } from "./helpers/api";
import { boardBox, openBoard, renderedCamera } from "./helpers/board";
import { dragOnBoard, settle } from "./helpers/notes";
import { withInputLock } from "./helpers/input-lock";
import { expectEventually, expectNoProblems, openSession } from "./helpers/participants";

/**
 * Story 9 - free text anywhere on the board (TC-26 to TC-31).
 *
 * These run in real browsers against the served build. Two things can only be
 * checked here: that the browser really wraps the text the way the board measured
 * it, and that several people writing text into one board converge.
 */

interface XY {
  x: number;
  y: number;
}

interface TextDom {
  id: string;
  text: string;
  /** Screen box, in CSS pixels (the board is at zoom 1 in these tests). */
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  widthMode: string;
  /** Line boxes the browser actually laid the text out into. */
  lines: number;
}

const PHRASE = "The quick brown fox jumps over the lazy dog. ";
/** The 300-character fixture of TC-26. */
const LONG_TEXT = PHRASE.repeat(8).slice(0, 300);

async function textObjects(page: Page): Promise<TextDom[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="text-object"]')).map((element) => {
      const box = element.getBoundingClientRect();
      const content = element.querySelector<HTMLElement>('[data-testid="text-object-text"]');
      let lines = 0;
      if (content && content.firstChild) {
        // One line box per distinct top: a Range hands back a rect per line box,
        // and a wrapped paragraph is exactly the number of lines it draws into.
        const range = document.createRange();
        range.selectNodeContents(content);
        lines = new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size;
      }
      return {
        id: element.getAttribute("data-note-id") ?? "",
        text: content ? content.textContent ?? "" : "",
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height,
        fontSize: Number.parseFloat(window.getComputedStyle(element).fontSize),
        widthMode: element.getAttribute("data-width-mode") ?? "",
        lines,
      };
    }),
  );
}

async function textObject(page: Page, id: string): Promise<TextDom> {
  const all = await textObjects(page);
  const found = all.find((entry) => entry.id === id);
  if (!found) throw new Error(`no text object ${id} on screen`);
  return found;
}

async function objectCount(page: Page): Promise<number> {
  return page.locator("[data-note-id]").count();
}

/** The board as the room has it, read through the sync protocol. */
async function roomObjects(
  boardId: string,
  atLeast: number,
): Promise<readonly ObjectSnapshot[]> {
  const client = await openSyncClient(E2E_PORT, boardId);
  client.requestSync();
  let objects: readonly ObjectSnapshot[] = [];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    objects = snapshot(client.doc);
    if (objects.length >= atLeast) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  client.close();
  return objects;
}

async function worldAt(page: Page, at: XY): Promise<XY> {
  const area = await boardBox(page);
  const camera = await renderedCamera(page);
  return { x: (at.x - area.x) / camera.zoom + camera.x, y: (at.y - area.y) / camera.zoom + camera.y };
}

async function screenOf(page: Page, world: XY): Promise<XY> {
  const area = await boardBox(page);
  const camera = await renderedCamera(page);
  return { x: area.x + (world.x - camera.x) * camera.zoom, y: area.y + (world.y - camera.y) * camera.zoom };
}

/** Press T, click, and type: the whole point of the story. */
async function writeText(page: Page, at: XY, value: string): Promise<string> {
  await page.keyboard.press("t");
  await expect(page.getByTestId("board-viewport")).toHaveAttribute("data-tool", "text");
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId("text-object-input")).toBeVisible();
  // Typed with a pause between characters, like a person. `keyboard.type` without
  // one puts every keystroke in the same browser task, and a 300-character burst
  // makes React count 300 renders in a single flush and abort the board with its
  // "maximum update depth" guard. A real keyboard, and a paste, never do that.
  await page.keyboard.type(value, { delay: 5 });
  await settle(page);
  const id = (await textObjects(page))[0]?.id;
  if (!id) throw new Error("the Text tool wrote no text object");
  return id;
}

async function endEditing(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("text-object-input")).toHaveCount(0);
  await settle(page);
}

async function clickOn(page: Page, selector: string): Promise<XY> {
  const locator = page.locator(selector);
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${selector} has no bounding box`);
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(centre.x, centre.y);
  await settle(page);
  return centre;
}

async function dragFrom(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const locator = page.locator(selector);
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${selector} has no bounding box`);
  await dragOnBoard(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, dx, dy);
}

async function handles(page: Page): Promise<string[]> {
  return page.$$eval("[data-handle]", (elements) => elements.map((element) => element.getAttribute("data-handle") ?? ""));
}

async function createStickyAt(page: Page, at: XY): Promise<void> {
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByTestId("sticky-note-input")).toBeVisible();
  await endEditing(page);
}

test.describe("long annotation and its wrapping", () => {
  test("TC-26 a 300-character annotation wraps at the automatic width limit", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });

    const boardId = await openBoard(page);

    const at = { x: 320, y: 220 };
    const id = await writeText(page, at, LONG_TEXT);
    await endEditing(page);

    const shown = await textObject(page, id);
    expect(shown.text).toBe(LONG_TEXT);

    // The box stopped growing at the automatic limit rather than running off.
    expect(shown.width).toBeCloseTo(TEXT_MAX_AUTO_WIDTH_WORLD, 2);
    expect(shown.widthMode).toBe("auto");

    // Several rendered lines, and the stored height matches what the browser
    // laid out - which is the point of measuring the text instead of dragging a
    // bottom edge.
    expect(shown.lines).toBeGreaterThanOrEqual(3);
    const modelLines = shown.height / (shown.fontSize * TEXT_LINE_HEIGHT);
    expect(Math.abs(shown.lines - modelLines)).toBeLessThanOrEqual(1);
    expect(shown.height).toBeGreaterThan(3 * shown.fontSize * TEXT_LINE_HEIGHT);

    // The same board from the room's side.
    const inRoom = await roomObjects(boardId, 1);
    const text = inRoom.find((object) => object.id === id);
    if (!text) throw new Error("the text object never reached the room");
    expect(text.type).toBe("text");
    expect(Math.abs((text.width ?? 0) - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
    expect(text.text).toBe(LONG_TEXT);

    // The page must not have logged anything broken on the way.
    expect(problems).toEqual([]);
  });

  test("TC-27 dragging the right handle narrower rewraps the words and grows the height", async ({ page }) => {
    await openBoard(page);

    const id = await writeText(page, { x: 300, y: 220 }, LONG_TEXT);
    await endEditing(page);

    const before = await textObject(page, id);
    expect(before.lines).toBeGreaterThanOrEqual(3);

    await clickOn(page, `[data-note-id="${id}"]`);
    expect(await handles(page)).toEqual(expect.arrayContaining(["e", "w"]));

    // Only the two sides: there is no handle that drags a height.
    expect(await handles(page)).toEqual(["e", "w"]);

    await dragFrom(page, '[data-testid="resize-handle-e"]', -260, 0);

    const after = await textObject(page, id);
    expect(after.widthMode).toBe("fixed");
    expect(after.width).toBeLessThan(before.width);
    expect(after.width).toBeGreaterThanOrEqual(TEXT_MIN_WIDTH_WORLD);
    // The same words, now needing more room.
    expect(after.text).toBe(LONG_TEXT);
    expect(after.lines).toBeGreaterThan(before.lines);
    expect(after.height).toBeGreaterThan(before.height);
    const modelLines = after.height / (after.fontSize * TEXT_LINE_HEIGHT);
    expect(Math.abs(after.lines - modelLines)).toBeLessThanOrEqual(1);

    // Still only the two sides, before and after.
    expect(await handles(page)).toEqual(["e", "w"]);
  });
});

test.describe("a heading over a cluster", () => {
  test("TC-28 title a retro section: write, enlarge, move, delete, undo", async ({ page }) => {
    await openBoard(page);

    // The cluster the heading belongs to.
    const cluster = [
      { x: 520, y: 420 },
      { x: 720, y: 420 },
      { x: 620, y: 580 },
    ];
    for (const point of cluster) {
      await createStickyAt(page, point);
    }
    expect(await objectCount(page)).toBe(3);

    // A heading above the cluster.
    const id = await writeText(page, { x: 480, y: 180 }, "Went well");
    await endEditing(page);

    // Size XL from the text's own toolbar.
    await clickOn(page, `[data-note-id="${id}"]`);
    await expect(page.getByTestId("text-toolbar")).toBeVisible();
    await page.getByTestId("text-size-XL").click();
    await settle(page);
    const sized = await textObject(page, id);
    expect(sized.fontSize).toBe(TEXT_SIZES.XL);
    expect(sized.text).toBe("Went well");

    // Drag it over the cluster.
    const beforeDrag = await textObject(page, id);
    await dragFrom(page, `[data-note-id="${id}"]`, 160, 280);
    const moved = await textObject(page, id);
    expect(moved.x).toBeCloseTo(beforeDrag.x + 160, 0);
    expect(moved.y).toBeCloseTo(beforeDrag.y + 280, 0);
    expect(moved.fontSize).toBe(TEXT_SIZES.XL);

    // Delete it, and bring it back with one undo.
    await clickOn(page, `[data-note-id="${id}"]`);
    await page.keyboard.press("Delete");
    await settle(page);
    await expect(page.locator(`[data-note-id="${id}"]`)).toHaveCount(0);
    expect(await objectCount(page)).toBe(3);

    await page.keyboard.press("Control+z");
    await settle(page);
    await expectEventually("TC-28 undo restores the heading", async () => {
      const all = await textObjects(page);
      return all.length === 1 && all[0]?.text === "Went well";
    });
    const restored = (await textObjects(page))[0];
    if (!restored) throw new Error("the heading never came back");
    expect(restored.fontSize).toBe(TEXT_SIZES.XL);
    // Its box is where it had been dragged.
    expect(restored.x).toBeCloseTo(moved.x, 0);
    expect(restored.y).toBeCloseTo(moved.y, 0);
  });
});

test.describe("abandoned text", () => {
  test("TC-31 text that was never written is not left on the board", async ({ page }) => {
    // A note first, so "nothing in the document" is something we can prove: the
    // document is not empty, it just holds no text object.
    const boardId = await openBoard(page);
    await createStickyAt(page, { x: 300, y: 300 });
    expect(await objectCount(page)).toBe(1);

    const spot = { x: 300, y: 150 };
    await page.keyboard.press("t");
    await page.mouse.click(spot.x, spot.y);
    await expect(page.getByTestId("text-object-input")).toBeVisible();

    // Escape without typing anything.
    await endEditing(page);

    await expect(page.locator('[data-testid="text-object"]')).toHaveCount(0);
    expect(await objectCount(page)).toBe(1);

    const objects = await roomObjects(boardId, 1);
    expect(objects.some((object) => object.type === "text")).toBe(false);
    expect(objects.filter((object) => object.type === "sticky")).toHaveLength(1);

    // Shift+drag over the spot selects nothing.
    const world = await worldAt(page, spot);
    const from = await screenOf(page, { x: world.x - 40, y: world.y - 40 });
    await page.keyboard.down("Shift");
    await dragOnBoard(page, from, 200, 160);
    await page.keyboard.up("Shift");
    await settle(page);
    await expect(page.getByTestId("selection-bar")).toHaveCount(0);
    const selected = await page.locator("[data-selected='true']").count();
    expect(selected).toBe(0);
  });
});

test.describe("several people writing text at once", () => {
  test("TC-29 two contexts typing into the same text end up with the same text", async ({ browser }) => {
    const session = await openSession(browser, ["Ada", "Bo"]);
    try {
      const [ada, bo] = session.participants;

      // Ada writes the first half and stays in the editor.
      await withInputLock(async () => {
        await ada.page.keyboard.press("t");
        await ada.page.mouse.click(360, 260);
        await expect(ada.page.getByTestId("text-object-input")).toBeVisible();
        await ada.page.keyboard.type("went well: ");
        await settle(ada.page);
      });
      const id = (await textObjects(ada.page))[0]?.id;
      if (!id) throw new Error("no text object was written");

      // Bo opens the same object and writes into it while Ada is still in it.
      await withInputLock(async () => {
        await bo.page.dblclick(`[data-note-id="${id}"]`);
        await expect(bo.page.getByTestId("text-object-input")).toBeVisible();
        await bo.page.keyboard.type("the board is faster");
        await settle(bo.page);
      });

      // Both keep writing at the same time.
      await Promise.all([
        withInputLock(async () => {
          await ada.page.keyboard.type(" and everyone kept up");
          await settle(ada.page);
        }),
        withInputLock(async () => {
          await bo.page.keyboard.type(", no lost characters");
          await settle(bo.page);
        }),
      ]);

      await withInputLock(async () => {
        await ada.page.keyboard.press("Escape");
        await bo.page.keyboard.press("Escape");
        await settle(ada.page);
        await settle(bo.page);
      });

      // Convergence: the text each person typed reaches the other screen. The
      // last keystrokes are still on the wire when typing stops, so this is
      // waited for rather than assumed.
      const fragments = [
        "went well: ",
        "the board is faster",
        " and everyone kept up",
        ", no lost characters",
      ];
      await expectEventually(
        "TC-29 both screens hold the same complete text",
        async () => {
          const onAda = (await textObjects(ada.page))[0]?.text ?? "";
          const onBo = (await textObjects(bo.page))[0]?.text ?? "";
          return onAda === onBo && fragments.every((fragment) => onAda.includes(fragment));
        },
        10_000,
      );

      const onAda = await textObjects(ada.page);
      const onBo = await textObjects(bo.page);
      expect(onAda).toHaveLength(1);
      expect(onBo).toHaveLength(1);
      const adaText = onAda[0]?.text ?? "";
      const boText = onBo[0]?.text ?? "";

      // Identical on both screens.
      expect(adaText).toBe(boText);
      // Every character each person typed is in it, and nothing else was added.
      for (const fragment of fragments) {
        expect(adaText).toContain(fragment);
      }
      expect(adaText.length).toBe(
        fragments.reduce((total, fragment) => total + fragment.length, 0),
      );

      expectNoProblems(session.participants);
    } finally {
      await session.close();
    }
  });

  test(`TC-30 ${MAX_CONCURRENT_EDITORS} contexts each write a heading at once`, async ({ browser }) => {
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_unused, index) => `Editor${index + 1}`);
    const session = await openSession(browser, names);
    try {
      const headings = names.map((name) => `Heading from ${name}`);

      // Every context has the Text tool waiting before anybody clicks.
      for (const participant of session.participants) {
        await participant.page.keyboard.press("t");
        await expect(participant.page.getByTestId("board-viewport")).toHaveAttribute("data-tool", "text");
      }

      // Each writes its own heading, at its own point, while the others do the same.
      await Promise.all(
        session.participants.map((participant, index) =>
          withInputLock(async () => {
            const at = { x: 220 + index * 120, y: 200 + index * 70 };
            await participant.page.mouse.click(at.x, at.y);
            await expect(participant.page.getByTestId("text-object-input")).toBeVisible();
            await participant.page.keyboard.type(headings[index] as string);
            await participant.page.keyboard.press("Escape");
            await settle(participant.page);
          }),
        ),
      );

      // Every heading is on every screen, complete. Text is still on the wire
      // when the last editor stops typing, so each screen is waited for.
      const expected = [...headings].sort();
      for (const viewer of session.participants) {
        await expectEventually(
          `TC-30 all headings on ${viewer.name}'s screen`,
          async () => {
            const texts = (await textObjects(viewer.page)).map((entry) => entry.text).sort();
            return texts.length === MAX_CONCURRENT_EDITORS && texts.every((text, index) => text === expected[index]);
          },
          10_000,
        );
      }

      for (const viewer of session.participants) {
        const texts = (await textObjects(viewer.page)).map((entry) => entry.text).sort();
        expect(texts).toEqual(expected);
      }

      expectNoProblems(session.participants);
    } finally {
      await session.close();
    }
  });
});
