// File-drop, file-picker and image-element helpers for story 12's e2e specs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Page, Locator } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', 'fixtures', 'images');

export interface DroppedFile {
  name: string;
  type: string;
  /** bytes, read from the fixture directory on the Node side */
  bytes: Buffer;
}

export function fixture(name: string): DroppedFile {
  const type = name.endsWith('.gif')
    ? 'image/gif'
    : name.endsWith('.jpg') || name.endsWith('.jpeg')
      ? 'image/jpeg'
      : name.endsWith('.webp')
        ? 'image/webp'
        : name.endsWith('.svg')
          ? 'image/svg+xml'
          : name.endsWith('.txt')
            ? 'text/plain'
            : 'image/png';
  return { name, type, bytes: readFileSync(join(FIXTURES, name)) };
}

export interface Cam {
  x: number;
  y: number;
  zoom: number;
}

export async function setCamera(page: Page, cam: Cam): Promise<void> {
  await page.evaluate((c) => {
    const hook = (window as unknown as { __vidi6?: { setCamera(cam: Cam): void } }).__vidi6;
    if (!hook) throw new Error('__vidi6 test hook missing (was the app built in test mode?)');
    hook.setCamera(c);
  }, cam);
  await page.waitForTimeout(50);
}

/**
 * Drop real fixture files onto the board at a screen point, as a genuine HTML5
 * drag-and-drop. A DataTransfer is filled with the fixture bytes and dispatched as a
 * `dragover` (so the drop is accepted and the highlight would show) then a `drop` on
 * the viewport - exactly the events the browser fires when a file is released there.
 * The `dataTransfer` is attached by property so the same path works wherever a
 * DragEvent constructor is not exposed.
 */
export async function dropFiles(
  page: Page,
  files: DroppedFile[],
  at: { x: number; y: number },
): Promise<void> {
  const payload = files.map((f) => ({ name: f.name, type: f.type, b64: f.bytes.toString('base64') }));
  await page.evaluate(({ files, x, y }) => {
    const el = document.querySelector('[data-testid="viewport"]') as HTMLElement;
    if (!el) throw new Error('no viewport to drop on');
    const dt = new DataTransfer();
    for (const f of files) {
      const raw = atob(f.b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      dt.items.add(new File([bytes], f.name, { type: f.type }));
    }
    for (const type of ['dragover', 'drop']) {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      el.dispatchEvent(ev);
    }
  }, { files: payload, x: at.x, y: at.y });
}

/**
 * Choose files through the board's file picker (the Image button and the I shortcut
 * both open it), by writing the fixture bytes into its <input type=file> - the
 * automated equivalent of picking files in the operating-system dialog.
 */
export async function pickFiles(page: Page, files: DroppedFile[]): Promise<void> {
  await page.setInputFiles(
    '[data-testid="image-picker"]',
    files.map((f) => ({ name: f.name, mimeType: f.type, buffer: f.bytes })),
  );
  await page.waitForTimeout(50);
}

export function imageEls(page: Page): Locator {
  return page.locator('[data-testid^="image-"][data-object-id]');
}

export interface ImageBox {
  id: string;
  status: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The image objects' world boxes and statuses, read from the DOM. */
export async function imageBoxes(page: Page): Promise<ImageBox[]> {
  return imageEls(page).evaluateAll((els) =>
    els.map((e) => {
      const h = e as HTMLElement;
      return {
        id: h.dataset.objectId ?? '',
        status: h.dataset.imageStatus ?? '',
        x: parseFloat(h.style.left),
        y: parseFloat(h.style.top),
        width: parseFloat(h.style.width),
        height: parseFloat(h.style.height),
      };
    }),
  );
}

/** Drag a handle (or any locator) by a screen offset, the way a resize is performed. */
export async function dragLocatorBy(page: Page, target: Locator, dx: number, dy: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('the thing to drag has no box on screen');
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x + (dx * i) / 8, from.y + (dy * i) / 8);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
}
