import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Page } from '@playwright/test';

export const fixturePath = (name: string) => new URL(`../../fixtures/images/${name}`, import.meta.url).pathname;

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

/** Builds a DataTransfer from fixture files inside the page and dispatches dragenter, dragover and drop at (x, y). */
export async function dropFiles(page: Page, names: string[], x: number, y: number): Promise<void> {
  const files = names.map((n) => ({
    name: basename(n),
    mime: MIME[n.split('.').pop() ?? ''] ?? 'application/octet-stream',
    base64: readFileSync(fixturePath(n)).toString('base64'),
  }));
  await page.evaluate(
    ({ files, x, y }) => {
      const dt = new DataTransfer();
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], f.name, { type: f.mime }));
      }
      const target = document.elementFromPoint(x, y) ?? document.body;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
      }
    },
    { files, x, y },
  );
}
