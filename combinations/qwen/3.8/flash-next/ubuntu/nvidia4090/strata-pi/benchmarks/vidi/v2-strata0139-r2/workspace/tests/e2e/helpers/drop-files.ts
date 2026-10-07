import { expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { type XY } from "./board";
import { screenOf } from "./selection";

/**
 * Story 12 e2e helpers: getting files onto a board the way a person does it, and
 * reading back what the board shows.
 *
 * A file drag is synthesised inside the page — `DataTransfer`, `File`, and a real
 * `DragEvent` dispatched on the board — because no Playwright API hands a file to
 * a page as a drop. Everything after that dispatch is the product's own code: the
 * sniffer reads the bytes, `createImageBitmap` decodes them, the upload is a real
 * XHR to the real Worker. The picker path needs no such trick: Playwright's file
 * chooser is the real dialog.
 */

/** Where the real fixture files live (Playwright runs tests from the project root). */
const FIXTURE_DIR = path.resolve(process.cwd(), "tests/fixtures/images");

export interface PageFile {
  name: string;
  type: string;
  /** base64 of the file's bytes, carried into the page. */
  data: string;
}

/** A fixture file from `tests/fixtures/images/`, optionally renamed or re-typed. */
export function fixtureFile(
  fileName: string,
  overrides: { name?: string; type?: string } = {},
): PageFile {
  const buffer = fs.readFileSync(path.join(FIXTURE_DIR, fileName));
  return {
    name: overrides.name ?? fileName,
    type: overrides.type ?? mimeTypeOf(fileName),
    data: buffer.toString("base64"),
  };
}

/** The same file for `setInputFiles`, which wants the disk path, not bytes in the page. */
export function fixturePath(fileName: string): string {
  return path.join(FIXTURE_DIR, fileName);
}

function mimeTypeOf(fileName: string): string {
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) return "image/jpeg";
  if (fileName.endsWith(".gif")) return "image/gif";
  if (fileName.endsWith(".webp")) return "image/webp";
  if (fileName.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

/**
 * Drags these files onto the board and drops them at a board point.
 *
 * `dragenter` and `dragover` come first because that is what makes the board show
 * its drop highlight; the drop itself is the third event of the same drag.
 */
export async function dropFiles(page: Page, at: XY, files: readonly PageFile[]): Promise<void> {
  const screen = await screenOf(page, at);
  await page.evaluate(
    ({ x, y, carried }) => {
      const transfer = new DataTransfer();
      for (const file of carried) {
        const bytes = Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));
        transfer.items.add(new File([bytes], file.name, { type: file.type }));
      }
      const target =
        document.elementFromPoint(x, y) ?? document.querySelector("[data-testid='board-viewport']");
      if (!target) throw new Error("there is no board to drop files on");
      for (const type of ["dragenter", "dragover", "dragover", "drop"]) {
        target.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
            clientX: x,
            clientY: y,
          }),
        );
      }
    },
    { x: screen.x, y: screen.y, carried: files },
  );
}

/**
 * Opens the picker through the Image button and answers it with these files —
 * the real dialog, in whatever browser is running.
 */
export async function chooseFiles(page: Page, files: readonly string[]): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("tool-image").click();
  const input = await chooser;
  await input.setFiles(files);
}

/** The same through the `I` shortcut. */
export async function chooseFilesByShortcut(page: Page, files: readonly string[]): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("i");
  const input = await chooser;
  await input.setFiles(files);
}

export interface ImageDom {
  id: string;
  /** The render state the board says this image is in. */
  status: string | null;
  width: number;
  height: number;
  /** `src` of the `<img>`, when there is one. */
  src: string | null;
}

/** Every image on this board, as its own component reports it. */
export async function images(page: Page): Promise<ImageDom[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-testid='image-object']")).map((element) => {
      const img = element.querySelector<HTMLImageElement>("img");
      return {
        id: element.getAttribute("data-note-id") ?? "",
        status: element.getAttribute("data-image-status"),
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        src: img ? img.getAttribute("src") : null,
      };
    }),
  );
}

export async function imageCount(page: Page): Promise<number> {
  return page.locator("[data-testid='image-object']").count();
}

export async function imageStatus(page: Page, id: string): Promise<string | null> {
  const found = (await images(page)).find((image) => image.id === id);
  return found ? found.status : null;
}

/** Waits until this image is in this render state, and returns how long it took. */
export async function waitImageStatus(
  page: Page,
  id: string,
  status: string,
  timeoutMs = 30_000,
): Promise<number> {
  const started = Date.now();
  await expect.poll(() => imageStatus(page, id), { timeout: timeoutMs, intervals: [50, 100, 250] }).toBe(status);
  return Date.now() - started;
}

/** The image this tab has just added, whether or not the test knows its id. */
export async function onlyImage(page: Page): Promise<ImageDom> {
  const found = await images(page);
  if (found.length !== 1) throw new Error(`expected one image on the board, found ${found.length}`);
  return found[0]!;
}

/** The text of every toast on screen, in the order they were raised. */
export async function toastTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-testid='toast-text']")).map((el) => el.textContent ?? ""),
  );
}

export async function waitForToasts(page: Page, expected: readonly string[], timeoutMs = 10_000): Promise<string[]> {
  let texts: string[] = [];
  await expect
    .poll(
      async () => {
        texts = await toastTexts(page);
        return expected.every((message) => texts.some((text) => text.includes(message)));
      },
      { timeout: timeoutMs, intervals: [100, 250] },
    )
    .toBe(true);
  return texts;
}

/** True while the board is showing that a file can be dropped on it. */
export async function dropHighlightVisible(page: Page): Promise<boolean> {
  return page.locator("[data-testid='drop-highlight']").isVisible();
}

/**
 * Every response this page got from the asset route, with the headers that matter
 * for `asset.serve`.
 */
export interface AssetResponse {
  url: string;
  status: number;
  cacheControl: string | null;
  contentType: string | null;
  nosniff: string | null;
  csp: string | null;
}

export async function assetResponses(page: Page): Promise<AssetResponse[]> {
  const responses: AssetResponse[] = [];
  page.on("response", (response) => {
    if (!response.url().includes("/api/assets/")) return;
    const headers = response.headers();
    responses.push({
      url: response.url(),
      status: response.status(),
      cacheControl: headers["cache-control"] ?? null,
      contentType: headers["content-type"] ?? null,
      nosniff: headers["x-content-type-options"] ?? null,
      csp: headers["content-security-policy"] ?? null,
    });
  });
  return responses;
}
