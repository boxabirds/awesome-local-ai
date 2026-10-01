import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Page } from '@playwright/test';

export const IMAGE_FIXTURES = 'tests/fixtures/images';

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
const mimeOf = (name: string): string => MIME[name.split('.').pop() ?? ''] ?? 'application/octet-stream';

/** Builds a DataTransfer from fixture files inside the page and dispatches dragenter, dragover and drop at a point. */
export async function dropFiles(page: Page, names: string[], at: { x: number; y: number }): Promise<void> {
  const files = names.map((n) => ({
    name: basename(n), type: mimeOf(n), base64: readFileSync(`${IMAGE_FIXTURES}/${n}`).toString('base64'),
  }));
  await page.evaluate(({ files: list, at: point }) => {
    const dt = new DataTransfer();
    for (const f of list) {
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], f.name, { type: f.type }));
    }
    const target = document.elementFromPoint(point.x, point.y) ?? document.body;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, dataTransfer: dt }));
    }
  }, { files, at });
}
