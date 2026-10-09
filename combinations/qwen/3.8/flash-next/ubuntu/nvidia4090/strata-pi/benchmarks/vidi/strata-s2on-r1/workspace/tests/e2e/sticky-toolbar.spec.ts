import { expect, test, type Page } from "@playwright/test";
import { boardCentre, openBoard, setCamera } from "./helpers/board";
import {
  createNoteByDoubleClick,
  dragNote,
  endEditingWithEscape,
  expectNear,
  noteCentreOnScreen,
  noteColor,
  noteCount,
  noteDisplayText,
  noteIds,
  noteLocator,
  noteWorldPosition,
  noteZIndex,
  waitForEditor,
} from "./helpers/stickies";
import { STICKY_COLORS } from "../../src/shared/config";
import { SHORT_PHRASE } from "../fixtures/texts";

function rgbOf(hex: string): number[] {
  const hexDigits = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(hexDigits.slice(i, i + 2), 16));
}

async function clickStickyNoteButton(page: Page) {
  await page.getByRole("button", { name: "Sticky note" }).click();
  await waitForEditor(page);
}

/**
 * sticky.toolbar, e2e level: the Sticky note button, colour swatches and delete
 * button, plus the brainstorm workflow the story is named after.
 */
test.describe("toolbars and the brainstorm workflow", () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page);
  });

  test("TC-34: the Sticky note button creates a note at the centre of the view, however far the board is panned", async ({
    page,
  }) => {
    const camera = await page.evaluate(() => window.__vidi6?.getCamera());
    if (!camera) throw new Error("camera test hook is missing");
    await setCamera(page, { x: 12345.5, y: -9876.25, zoom: 1 });

    await clickStickyNoteButton(page);
    const ids = await noteIds(page);
    expect(ids).toHaveLength(1);

    const centre = await boardCentre(page);
    await expectNear(await noteCentreOnScreen(page, ids[0]), centre, 1);
    const cameraNow = await page.evaluate(() => window.__vidi6?.getCamera());
    if (!cameraNow) throw new Error("camera test hook is missing");
    const worldCentre = {
      x: cameraNow.x + centre.x / cameraNow.zoom,
      y: cameraNow.y + centre.y / cameraNow.zoom,
    };
    const position = await noteWorldPosition(page, ids[0]);
    expect(position.x).toBeCloseTo(worldCentre.x - 100, 1);
    expect(position.y).toBeCloseTo(worldCentre.y - 100, 1);

    // It accepts typing straight away, with no extra click.
    await page.keyboard.type(SHORT_PHRASE);
    await endEditingWithEscape(page);
    expect(await noteDisplayText(page, ids[0])).toBe(SHORT_PHRASE);
  });

  test("TC-34b: the button works at other zoom levels too", async ({ page }) => {
    const camera = await page.evaluate(() => window.__vidi6?.getCamera());
    if (!camera) throw new Error("camera test hook is missing");
    await setCamera(page, { ...camera, zoom: 0.5 });

    await clickStickyNoteButton(page);
    const id = (await noteIds(page))[0];
    await expectNear(await noteCentreOnScreen(page, id), await boardCentre(page), 1);
  });

  test("the colour swatches recolour the note and keep everything else", async ({ page }) => {
    const id = await createNoteByDoubleClick(page, 500, 400);
    await page.keyboard.type("keep standups short");
    await endEditingWithEscape(page);

    expect(await noteColor(page, id)).toEqual(rgbOf(STICKY_COLORS.yellow));
    const before = await noteWorldPosition(page, id);

    await page.getByRole("button", { name: "Pink colour" }).click();

    expect(await noteColor(page, id)).toEqual(rgbOf(STICKY_COLORS.pink));
    expect(await noteWorldPosition(page, id)).toEqual(before);
    expect(await noteDisplayText(page, id)).toBe("keep standups short");
    expect(await noteLocator(page, id).getAttribute("data-selected")).toBe("true");

    await page.getByRole("button", { name: "Blue colour" }).click();
    expect(await noteColor(page, id)).toEqual(rgbOf(STICKY_COLORS.blue));
  });

  test("the note toolbar keeps a constant size on screen at every zoom", async ({ page }) => {
    const camera = await page.evaluate(() => window.__vidi6?.getCamera());
    if (!camera) throw new Error("camera test hook is missing");

    await createNoteByDoubleClick(page, 640, 450);
    await endEditingWithEscape(page);

    const sizes: number[] = [];
    for (const zoom of [0.5, 1, 2]) {
      await setCamera(page, { ...camera, zoom });
      const box = await page.getByTestId("note-toolbar").boundingBox();
      if (!box) throw new Error("note toolbar has no bounding box");
      sizes.push(Math.round(box.width), Math.round(box.height));
    }

    // Same toolbar size on screen at 50%, 100% and 200% (anti-aliasing slack).
    for (let i = 0; i < sizes.length; i += 2) {
      expect(Math.abs(sizes[i] - sizes[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(sizes[i + 1] - sizes[1])).toBeLessThanOrEqual(1);
    }
    expect(sizes[0]).toBeGreaterThan(60);
  });

  test("TC-29: the delete button removes the note", async ({ page }) => {
    const id = await createNoteByDoubleClick(page, 640, 400);
    await endEditingWithEscape(page);

    await page.getByRole("button", { name: "Delete note" }).click();
    await expect(noteLocator(page, id)).toHaveCount(0);
    expect(await noteCount(page)).toBe(0);
    await expect(page.getByTestId("note-toolbar")).toHaveCount(0);
  });

  test("golden path: capture three ideas, rearrange them, recolour one, delete one", async ({
    page,
  }) => {
    const camera = await page.evaluate(() => window.__vidi6?.getCamera());
    if (!camera) throw new Error("camera test hook is missing");

    // Capture: three ideas, each by double-click and typing.
    const first = await createNoteByDoubleClick(page, 360, 300);
    await page.keyboard.type("Faster onboarding");
    await endEditingWithEscape(page);

    const second = await createNoteByDoubleClick(page, 700, 380);
    await page.keyboard.type("Cut the standup to five minutes");
    await endEditingWithEscape(page);

    const third = await createNoteByDoubleClick(page, 520, 620);
    await page.keyboard.type("Pair on the flaky tests");
    await endEditingWithEscape(page);
    expect(await noteCount(page)).toBe(3);

    // Rearrange at 50% zoom: the third idea moves next to the first.
    await setCamera(page, { ...camera, zoom: 0.5 });
    const before = await noteWorldPosition(page, third);
    const grab = await dragNote(page, third, 140, 40);
    const after = await noteWorldPosition(page, third);
    expect(after.x - before.x).toBeCloseTo(280, 1);
    expect(after.y - before.y).toBeCloseTo(80, 1);
    await expectNear(await noteCentreOnScreen(page, third), { x: grab.x + 140, y: grab.y + 40 }, 1);

    // The dragged note is on top of anything it now overlaps.
    expect(await noteZIndex(page, third)).toBeGreaterThan(await noteZIndex(page, first));

    // Colours: the ideas are told apart by more than position.
    await page.getByRole("button", { name: "Green colour" }).click();
    expect(await noteColor(page, third)).toEqual(rgbOf(STICKY_COLORS.green));
    expect(await noteColor(page, first)).toEqual(rgbOf(STICKY_COLORS.yellow));

    // Delete: the standup idea is dropped with the Delete key.
    const centre = await noteCentreOnScreen(page, second);
    await page.mouse.click(centre.x, centre.y);
    expect(await noteLocator(page, second).getAttribute("data-selected")).toBe("true");
    await page.keyboard.press("Delete");
    await expect(noteLocator(page, second)).toHaveCount(0);

    const remaining = await noteIds(page);
    expect(remaining).toHaveLength(2);
    expect(remaining).toEqual([first, third]);
    expect(await noteDisplayText(page, first)).toBe("Faster onboarding");
    expect(await noteDisplayText(page, third)).toBe("Pair on the flaky tests");
    expect(await noteColor(page, third)).toEqual(rgbOf(STICKY_COLORS.green));

    // The board itself never moved while notes were captured and rearranged.
    expect(await page.evaluate(() => window.__vidi6?.getCamera())).toEqual({
      ...camera,
      zoom: 0.5,
    });
  });
});
