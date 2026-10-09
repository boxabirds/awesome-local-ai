import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

export interface FixtureFile {
  name: string;
  type: string;
  base64: string;
}

export interface DropPoint {
  x: number;
  y: number;
}

const FIXTURES = resolve(fileURLToPath(import.meta.url), '../../../fixtures/images');

export function fixtureFile(fileName: string, type = guessType(fileName)): FixtureFile {
  return {
    name: fileName,
    type,
    base64: readFileSync(resolve(FIXTURES, fileName)).toString('base64')
  };
}

function guessType(fileName: string): string {
  if (fileName.endsWith('.png')) return 'image/png';
  if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) return 'image/jpeg';
  if (fileName.endsWith('.webp')) return 'image/webp';
  if (fileName.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

// A file picker drop can't be simulated by sending the bytes over the wire, so
// the fixtures are rebuilt as real Files inside the page and attached to a
// genuine DataTransfer on synthetic drag events over the viewport.
async function fireDragEvent(
  page: Page,
  type: string,
  files: readonly FixtureFile[],
  point: DropPoint
): Promise<void> {
  await page.evaluate(
    ({ type, files, point }) => {
      const transfer = new DataTransfer();
      for (const file of files) {
        const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
        transfer.items.add(new File([bytes], file.name, { type: file.type }));
      }
      const element = document.querySelector('[data-testid="board-viewport"]');
      if (element === null) throw new Error('board viewport not mounted');
      element.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
          dataTransfer: transfer
        })
      );
    },
    { type, files, point }
  );
}

export async function dragFilesOver(
  page: Page,
  files: readonly FixtureFile[],
  point: DropPoint
): Promise<void> {
  await fireDragEvent(page, 'dragenter', files, point);
  await fireDragEvent(page, 'dragover', files, point);
}

export async function dragFilesLeave(
  page: Page,
  files: readonly FixtureFile[],
  point: DropPoint
): Promise<void> {
  await fireDragEvent(page, 'dragleave', files, point);
}

export async function dropFiles(
  page: Page,
  files: readonly FixtureFile[],
  point: DropPoint
): Promise<void> {
  await fireDragEvent(page, 'drop', files, point);
}
