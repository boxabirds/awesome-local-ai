/**
 * E2E helpers for story 12: getting real files onto a real board, and reading what the board made
 * of them.
 *
 * A person has three ways to add an image - drag, paste, or the Image tool's picker - and each one
 * begins somewhere a test cannot imitate by clicking: the operating system's file list. Two of them
 * are done honestly here. The picker is driven through Playwright's own file-chooser interception,
 * which is the browser's real path for "the user picked these". A drop is built as a real
 * `DataTransfer` holding real `File` objects and dispatched at the point on the screen the file was
 * let go: the app cannot tell it from a mouse-driven drop, because there is no such difference - the
 * handler only ever sees a DataTransfer.
 */
import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ImageSnapshot } from '../../../src/shared/board-model';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';
import { type Participant } from './participants';

/** A file as the browser will be handed it: bytes, a name, and the type the OS would claim. */
export interface DroppedFile {
  name: string;
  type: string;
  buffer: Buffer;
}

const FIXTURES = fileURLToPath(new URL('../../fixtures/images', import.meta.url));

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
};

function mimeOf(name: string): string {
  const dot = name.lastIndexOf('.');
  const type = MIME[name.slice(dot).toLowerCase()];
  if (!type) throw new Error(`no MIME type known for ${name}`);
  return type;
}

/** A committed fixture, by file name. */
export function imageFixture(name: string): DroppedFile {
  return { name, type: mimeOf(name), buffer: readFileSync(resolve(FIXTURES, name)) };
}

/**
 * A file that is not a fixture because it is far too big to commit: bytes with a real JPEG header and
 * nothing else, padded to just over the board's 10 MB limit.
 *
 * It never has to be a picture. The size limit is a decision about bytes, made before anything is
 * decoded, and that decision is what the test is checking.
 */
export function oversizedJpeg(bytes: number): DroppedFile {
  const header = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/',
    'base64',
  );
  return {
    name: 'huge-scan.jpg',
    type: 'image/jpeg',
    buffer: Buffer.concat([header, Buffer.alloc(Math.max(0, bytes - header.length))]),
  };
}

/** A PDF whose name claims to be a PNG: the file type check is about what the file says it is. */
export function pdfNamedPng(): DroppedFile {
  const fixture = imageFixture('report.pdf');
  return { ...fixture, name: 'quarterly-report.png', type: 'application/pdf' };
}

/**
 * Drags files onto a point of the screen, and answers with the moment they were let go.
 *
 * The three events of a real drop are sent in order - a person hovering gets a highlight before the
 * drop itself - at whatever element is under the point, so the events bubble the way a mouse makes
 * them bubble.
 */
export async function dropFiles(
  page: Page,
  files: readonly DroppedFile[],
  point: { x: number; y: number },
): Promise<number> {
  const payload = files.map((file) => ({
    name: file.name,
    type: file.type,
    data: file.buffer.toString('base64'),
  }));
  const droppedAt = Date.now();
  await page.evaluate(
    ({ files, point }) => {
      const transfer = new DataTransfer();
      for (const file of files) {
        const binary = atob(file.data);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        transfer.items.add(new File([bytes], file.name, { type: file.type }));
      }
      const target = document.elementFromPoint(point.x, point.y) ?? document.body;
      for (const kind of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(
          new DragEvent(kind, {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
            clientX: point.x,
            clientY: point.y,
          }),
        );
      }
    },
    { files: payload, point },
  );
  return droppedAt;
}

/** The board's images, as one participant's document holds them. */
export function imagesOf(participant: Participant): Promise<ImageSnapshot[]> {
  return participant.page.evaluate(() =>
    window
      .__vidi6!.getObjects()
      .filter((object): object is ImageSnapshot => object.type === 'image'),
  );
}

/** How many image boxes are drawn, and in what state each one is. */
export function imageStates(participant: Participant): Promise<string[]> {
  return participant.page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-image-object]')).map((element) => {
      const inner = element.querySelector<HTMLElement>('.image-object__inner');
      return inner?.getAttribute('data-image-state') ?? 'unknown';
    }),
  );
}

/** Every message the board is showing at the bottom of the screen. */
export function toastMessages(participant: Participant): Promise<string[]> {
  return participant.page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="board-toast"] p')).map(
      (element) => element.textContent ?? '',
    ),
  );
}

/** Waits until every image on this board has finished uploading and been filled in. */
export async function waitForReadyImages(
  participant: Participant,
  count: number,
): Promise<ImageSnapshot[]> {
  let ready: ImageSnapshot[] = [];
  await expect
    .poll(
      async () => {
        ready = (await imagesOf(participant)).filter((image) => image.status === 'ready');
        return ready.length;
      },
      {
        message: `${count} images never became ready on ${participant.name}'s board`,
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      },
    )
    .toBe(count);
  return ready;
}

/**
 * The widths the browser actually decoded, per drawn picture.
 *
 * A picture element with `naturalWidth` 0 is a broken image: the address was asked for and nothing
 * usable came back. This is the difference between "the board knows about an image" and "this person
 * can see it".
 */
export function loadedPictureWidths(participant: Participant): Promise<number[]> {
  return participant.page.$$eval(
    '[data-testid="image-picture"]',
    (elements) => (elements as HTMLImageElement[]).map((element) => element.naturalWidth),
  );
}

/** Where a drawn image sits and how big it is on screen, in CSS pixels. */
export function imageBoxes(
  participant: Participant,
): Promise<{ id: string; x: number; y: number; width: number; height: number }[]> {
  return participant.page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-image-object]')).map((element) => ({
      id: element.getAttribute('data-image-id') ?? '',
      x: Number.parseFloat(element.style.left),
      y: Number.parseFloat(element.style.top),
      width: Number.parseFloat(element.style.width),
      height: Number.parseFloat(element.style.height),
    })),
  );
}

/** Opens the picker through the Image tool and hands it files, returning what the chooser got. */
export async function chooseFiles(page: Page, files: readonly DroppedFile[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-image-button').click();
  const picked = await chooser;
  await picked.setFiles(
    files.map((file) => ({ name: file.name, mimeType: file.type, buffer: file.buffer })),
  );
}
