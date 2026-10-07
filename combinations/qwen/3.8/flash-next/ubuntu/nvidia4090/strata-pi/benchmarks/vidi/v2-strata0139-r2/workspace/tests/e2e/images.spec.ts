import { expect, test, type Page } from "@playwright/test";
import { IMAGE_MIN_SIZE_WORLD } from "../../src/shared/config";
import { openBoard } from "./helpers/board";
import { dragHandleBy, selectIds, worldBox } from "./helpers/selection";
import { settle } from "./helpers/notes";
import {
  connectionStateOf,
  expectEventually,
  expectNoProblems,
  openParticipant,
  openSession,
  reportLatencies,
  resetLatencies,
  waitUntilConnected,
  type Session,
} from "./helpers/participants";
import {
  assetResponses,
  chooseFiles,
  dropFiles,
  dropHighlightVisible,
  fixtureFile,
  fixturePath,
  imageCount,
  images,
  onlyImage,
  toastTexts,
  waitForToasts,
  waitImageStatus,
  type AssetResponse,
} from "./helpers/drop-files";

/**
 * Story 12 — images dropped onto the board (TC-25 to TC-29).
 *
 * What only a real browser can answer: that bytes which arrived as a file drag are
 * sniffed, decoded, uploaded to real R2 and drawn; that the other screen sees a
 * placeholder before it sees the picture, and that the picture is served with the
 * caching a copy-once image wants; that a file whose name lies is refused; that an
 * aspect-locked image keeps its proportions when a corner is dragged and stops at
 * its floor; and that an upload which failed can be retried into a picture on both
 * screens.
 *
 * The synthesized file drag uses the `DataTransfer` and `DragEvent` constructors,
 * which in this repo's browser set is a Chromium API, so the drop-driven tests run
 * in Chromium. The picker test (TC-26) uses Playwright's file chooser — the real
 * dialog — and runs in every browser installed here.
 */

const TYPE_MESSAGE = "Only PNG, JPEG, GIF and WebP images can be added.";
const SIZE_MESSAGE = "Images must be 10 MB or smaller.";
const UPLOAD_FAILED = "Upload failed";
const UNAVAILABLE = "Image unavailable";
const SCREENSHOT = "screenshot.png";

/**
 * Console errors and uncaught exceptions a single-page test's page produced.
 * `expectNoProblems` covers a session; a test with one page needs the same eyes.
 */
function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/** Uploads slowed only enough that the uploading state is something a test can see. */
async function slowUploads(page: Page, delayMs: number): Promise<void> {
  await page.route((url) => url.pathname.endsWith("/assets"), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fallback();
  });
}

/**
 * A board this page can add images to: open, and in sync with the room. The board
 * refuses to add an image it cannot finish (`image.offline`), so a test that drops
 * files must not ask before the connection is up.
 */
async function openSyncedBoard(page: Page): Promise<string> {
  const boardId = await openBoard(page);
  await expect.poll(() => connectionStateOf(page), { timeout: 20_000 }).toBe("connected");
  return boardId;
}

async function waitForReadyImage(page: Page, expected = 1): Promise<void> {
  await expect
    .poll(async () => (await images(page)).filter((image) => image.status === "ready").length, { timeout: 30_000 })
    .toBe(expected);
}

test.describe("story 12: images on the board", () => {
  test("TC-25 three screenshots dropped by one person arrive on the other screen", async ({ browser }) => {
    test.skip(
      !test.info().project.name.includes("chromium"),
      "the synthesized file drag needs the DataTransfer constructor, which is Chromium here",
    );
    resetLatencies();
    const session: Session = await openSession(browser, ["Leo", "Sam"]);
    const leo = session.participants[0]!;
    const sam = session.participants[1]!;
    const samResponses: AssetResponse[] = await assetResponses(sam.page);
    try {
      // The upload is slowed, not broken: the point is to have time to look at a
      // placeholder before it becomes a photograph.
      await slowUploads(leo.page, 1_500);

      // A file drag gets an answer from the board before anything is dropped.
      await leo.page.evaluate(() => {
        const board = document.querySelector<HTMLElement>("[data-testid='board-viewport']");
        if (!board) throw new Error("no board");
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "hover.png", { type: "image/png" }));
        board.dispatchEvent(
          new DragEvent("dragenter", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
            clientX: 300,
            clientY: 300,
          }),
        );
      });
      expect(await dropHighlightVisible(leo.page)).toBe(true);

      await dropFiles(leo.page, { x: -600, y: -300 }, [
        fixtureFile(SCREENSHOT),
        fixtureFile("photo.webp"),
        fixtureFile("animated.gif"),
      ]);

      // Leo sees their own uploads with a percentage nobody else can see; Sam sees
      // the same three boxes saying only that something is being uploaded.
      await expect(leo.page.getByTestId("image-uploading").first()).toBeVisible();
      await expect(sam.page.getByTestId("image-other-uploading")).toHaveCount(3);
      const placeholderTook = await expectEventually(
        "3 uploading placeholders reach Sam",
        async () => (await images(sam.page)).length === 3,
      );
      // Nothing has been fetched yet: there was nothing to fetch.
      expect(samResponses).toHaveLength(0);

      const leoIds = (await images(leo.page)).map((image) => image.id);
      expect(leoIds).toHaveLength(3);
      for (const id of leoIds) await waitImageStatus(leo.page, id, "ready");

      const samTook = await expectEventually(
        "all 3 images ready on Sam's screen",
        async () => (await images(sam.page)).every((image) => image.status === "ready"),
      );
      console.log(`[story 12] placeholders reached Sam in ${placeholderTook}ms, pictures in ${samTook}ms`);

      // `image.placement_size`, as drawn: a 1440 × 900 screenshot sits at 800 × 500.
      const samImages = await images(sam.page);
      const screenshot = samImages.find((image) => Math.abs(image.width / image.height - 1.6) < 0.02);
      expect(screenshot).toBeTruthy();
      expect(screenshot!.width).toBeCloseTo(800, 1);
      expect(screenshot!.height).toBeCloseTo(500, 1);
      for (const image of samImages) {
        expect(image.src).toContain(`/api/assets/${session.boardId}/`);
      }

      // `asset.serve`: the browser fetched each one, and was told to keep it.
      await expect.poll(() => samResponses.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
      for (const response of samResponses) {
        expect(response.status).toBe(200);
        expect(response.cacheControl).toBe("public, max-age=31536000, immutable");
        expect(response.nosniff).toBe("nosniff");
        expect(response.csp).toBe("default-src 'none'");
        expect(response.contentType).toMatch(/^image\//);
      }
    } finally {
      reportLatencies();
      expectNoProblems(session.participants, [/net::ERR_FAILED/, /Failed to load resource/]);
      await session.close();
    }
  });

  test("TC-26 a picker batch of one good file and two bad ones adds one image", async ({ page }) => {
    const problems = watchProblems(page);
    const boardId = await openSyncedBoard(page);
    try {
      await chooseFiles(page, [
        fixturePath("tiny.png"),
        fixturePath("renamed-pdf.png"),
        fixturePath("photo.jpg"),
      ]);

      // `image.validation` in the PRD's own words: the PDF renamed as a PNG is
      // refused by its bytes, the 11 MB JPEG by its size.
      const texts = await waitForToasts(page, [TYPE_MESSAGE, SIZE_MESSAGE]);
      expect(texts).toContain(TYPE_MESSAGE);
      expect(texts).toContain(SIZE_MESSAGE);

      await waitForReadyImage(page);
      const image = await onlyImage(page);
      expect(image.src).toContain(`/api/assets/${boardId}/`);

      // The Image tool was a way in, not a mode the board stays in.
      await expect(page.getByTestId("tool-image")).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByTestId("tool-select")).toHaveAttribute("aria-pressed", "true");
    } finally {
      expect(problems).toEqual([]);
    }
  });

  test("TC-27 a corner resize keeps the picture's proportions and stops at its floor", async ({
    page,
    browser,
  }) => {
    test.skip(
      !test.info().project.name.includes("chromium"),
      "the synthesized file drag needs the DataTransfer constructor, which is Chromium here",
    );
    const problems = watchProblems(page);
    const boardId = await openSyncedBoard(page);
    try {
      await dropFiles(page, { x: -420, y: -260 }, [fixtureFile(SCREENSHOT)]);
      await waitForReadyImage(page);
      const image = await onlyImage(page);

      const before = await worldBox(page, image.id);
      expect(before.width).toBeCloseTo(800, 1);
      expect(before.height).toBeCloseTo(500, 1);

      await selectIds(page, [image.id]);
      await dragHandleBy(page, "se", { x: -180, y: -60 });
      const resized = await worldBox(page, image.id);
      expect(resized.width).toBeLessThan(before.width - 100);
      // `image.aspect_resize`: the ratio a corner drag produced is the ratio the
      // photograph has, to within one per cent.
      expect(Math.abs(resized.width / resized.height - before.width / before.height)).toBeLessThan(0.01);

      // And far past the floor: the drag stops where the type's minimum is.
      await dragHandleBy(page, "se", { x: -1_000, y: -1_000 });
      const floor = await worldBox(page, image.id);
      expect(Math.min(floor.width, floor.height)).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 1);
      expect(Math.min(floor.width, floor.height)).toBeLessThan(IMAGE_MIN_SIZE_WORLD + 2);
      expect(Math.abs(floor.width / floor.height - 1.6)).toBeLessThan(0.01);

      // One undo takes the whole last resize back.
      await page.keyboard.press("Control+z");
      await settle(page);
      const back = await worldBox(page, image.id);
      expect(Math.abs(back.width - resized.width)).toBeLessThan(2);

      // `image.revisit`: the same board, opened later, in another browser context.
      const visitor = await openParticipant(browser, "Visitor", boardId);
      try {
        await waitUntilConnected(visitor);
        const later = await images(visitor.page);
        expect(later).toHaveLength(1);
        expect(later[0]!.status).toBe("ready");
        expect(later[0]!.src).toContain(`/api/assets/${boardId}/`);
        await expect(visitor.page.getByTestId("image-content")).toBeVisible();
      } finally {
        await visitor.context.close();
      }
    } finally {
      expect(problems).toEqual([]);
    }
  });

  test("TC-28 an upload that fails can be retried into a picture on both screens", async ({ browser }) => {
    test.skip(
      !test.info().project.name.includes("chromium"),
      "the synthesized file drag needs the DataTransfer constructor, which is Chromium here",
    );
    resetLatencies();
    const session = await openSession(browser, ["Leo", "Sam"]);
    const leo = session.participants[0]!;
    const sam = session.participants[1]!;
    // Only the upload: the asset's own address is left alone.
    const uploadRoute = (url: URL) => url.pathname.endsWith("/assets");
    try {
      await leo.page.route(uploadRoute, (route) => route.abort());

      await dropFiles(leo.page, { x: 100, y: 100 }, [fixtureFile("tiny.png")]);
      await expect.poll(() => imageCount(leo.page)).toBe(1);

      // The uploader is told it failed, and is given a way to try again.
      const failed = leo.page.getByTestId("image-failed");
      await expect(failed).toBeVisible({ timeout: 20_000 });
      await expect(failed).toContainText(UPLOAD_FAILED);
      await expect(leo.page.getByTestId("image-retry")).toBeVisible();
      await expect(leo.page.getByTestId("image-remove")).toBeVisible();

      // Everybody else only learns the image is not there.
      await expect(sam.page.getByTestId("image-unavailable")).toBeVisible({ timeout: 20_000 });
      await expect(sam.page.getByTestId("image-unavailable")).toContainText(UNAVAILABLE);
      expect((await images(sam.page))[0]!.status).toBe("failed");

      // The network is not broken any more, and the file is still in this tab.
      await leo.page.unroute(uploadRoute);
      await leo.page.getByTestId("image-retry").click();

      const id = (await onlyImage(leo.page)).id;
      const leoTook = await waitImageStatus(leo.page, id, "ready");
      const samTook = await expectEventually(
        "the retried image arrives on Sam's screen",
        async () => (await images(sam.page))[0]?.status === "ready",
      );
      console.log(`[story 12] retry ready in ${leoTook}ms, shared in ${samTook}ms`);
      const ready = await onlyImage(leo.page);
      expect(ready.src).toContain(`/api/assets/${session.boardId}/`);

      // Failing changed what the object says, not what it is: same box, still there.
      const box = await worldBox(leo.page, id);
      expect(box.width).toBeGreaterThan(IMAGE_MIN_SIZE_WORLD);
    } finally {
      reportLatencies();
      // The aborted upload is a console error the browser reports by itself.
      expectNoProblems(session.participants, [/net::ERR_FAILED/, /Failed to load resource/]);
      await session.close();
    }
  });

  test("TC-29 files whose bytes are not decodable images never reach the board", async ({ page }) => {
    test.skip(
      !test.info().project.name.includes("chromium"),
      "the synthesized file drag needs the DataTransfer constructor, which is Chromium here",
    );
    const problems = watchProblems(page);
    await openSyncedBoard(page);
    try {
      await dropFiles(page, { x: -300, y: -200 }, [
        // A PNG header with a broken body, an SVG, and one real screenshot.
        fixtureFile("corrupt.png"),
        fixtureFile("script.svg", { name: "drawing.png", type: "image/png" }),
        fixtureFile(SCREENSHOT),
      ]);

      await expect(page.getByText(TYPE_MESSAGE)).toBeVisible({ timeout: 15_000 });
      expect(await toastTexts(page)).toContain(TYPE_MESSAGE);
      await waitForReadyImage(page);
      expect(await onlyImage(page)).toMatchObject({ status: "ready" });
    } finally {
      expect(problems).toEqual([]);
    }
  });
});
