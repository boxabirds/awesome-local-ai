import type { Page } from '@playwright/test';
import { imageBytes } from '../../fixtures/images';

export interface DropFile { name: string; type: string; bytes: Uint8Array }

export const fixtureFile = (name: string, type: string, as = name): DropFile => ({ name: as, type, bytes: imageBytes(name) });

/** Builds a DataTransfer inside the page from the given bytes and dispatches dragenter/dragover/drop at a screen point. */
export async function dropFiles(page: Page, files: DropFile[], at: { x: number; y: number }): Promise<void> {
  const payload = files.map((f) => ({ name: f.name, type: f.type, data: Buffer.from(f.bytes).toString('base64') }));
  await page.evaluate(({ payload: list, at: point }) => {
    const dt = new DataTransfer();
    for (const f of list) {
      const bin = atob(f.data);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], f.name, { type: f.type }));
    }
    const target = document.querySelector('[data-testid="board-viewport"]')!;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: point.x, clientY: point.y }));
    }
  }, { payload, at });
}
