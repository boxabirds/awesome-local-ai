import { Page } from '@playwright/test';

export interface DropFile {
  name: string;
  type: string;
  /** Base64-encoded file bytes. */
  base64: string;
}

/**
 * Story 12: dispatch a native `drop` event carrying real Files onto a
 * selector. The Files are built in the page context so the browser's own
 * File/DataTransfer classes are used.
 */
export async function dropFilesOn(page: Page, selector: string, files: DropFile[]): Promise<void> {
  const dataTransfer = await page.evaluateHandle(
    ({ files }) => {
      const dt = new DataTransfer();
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], f.name, { type: f.type }));
      }
      return dt;
    },
    { files },
  );
  await page.dispatchEvent(selector, 'drop', { dataTransfer });
}

/**
 * Generate a real PNG in the page (via canvas) and return it base64-encoded.
 */
export async function canvasPngBase64(page: Page, width: number, height: number, color = '#ff0000'): Promise<string> {
  return page.evaluate(
    async ({ width, height, color }) => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
      const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? new Blob()), 'image/png'));
      return new Promise<string>((res) => {
        const fr = new FileReader();
        fr.onload = () => res((fr.result as string).split(',')[1]);
        fr.readAsDataURL(blob);
      });
    },
    { width, height, color },
  );
}

/**
 * Read the current object snapshot from the page (via the __vidi6 test hook).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getBoardObjects(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__vidi6.getObjects());
}
