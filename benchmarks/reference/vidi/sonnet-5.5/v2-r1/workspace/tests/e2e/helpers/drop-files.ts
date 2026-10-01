import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { Page } from '@playwright/test';

export const fixturePath = (name: string): string => resolve('tests/fixtures/images', name);

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
export const payload = (name: string) => ({ name, mimeType: mimeOf(name), buffer: readFileSync(fixturePath(name)) });
export const mimeOf = (name: string): string => MIME[name.split('.').pop() ?? ''] ?? 'application/octet-stream';

/**
 * Builds a DataTransfer from fixture files inside the page and dispatches dragenter, dragover and drop
 * at the given board point (screen coordinates).
 */
export async function dropFiles(page: Page, names: string[], at: { x: number; y: number }, opts: { dropEvent?: boolean } = {}) {
  const files = names.map((n) => ({ name: basename(n), type: mimeOf(n), data: readFileSync(fixturePath(n)).toString('base64') }));
  await page.evaluate(
    ({ files, at, dropEvent }) => {
      const dt = new DataTransfer();
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], f.name, { type: f.type }));
      }
      const target = document.querySelector('[data-testid="board-viewport"]')!;
      const fire = (type: string) =>
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, dataTransfer: dt }));
      fire('dragenter');
      fire('dragover');
      if (dropEvent !== false) fire('drop');
    },
    { files, at, dropEvent: opts.dropEvent },
  );
}
