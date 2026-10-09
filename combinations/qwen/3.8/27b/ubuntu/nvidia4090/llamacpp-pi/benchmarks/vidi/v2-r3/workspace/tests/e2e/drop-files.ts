/**
 * Story 12 e2e helper: drop file(s) onto a board point in a real browser.
 *
 * Playwright cannot put files into a DataTransfer from Node, so the files
 * (fixture bytes) are serialised into the page, rebuilt as File objects,
 * attached to a DataTransfer and dispatched as dragenter/dragover/drop on
 * the element at the target point — the same events a real OS drop produces.
 */
import type { Page } from '@playwright/test';

export interface DropFile {
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array;
}

export async function dropFilesAt(page: Page, files: DropFile[], x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ names, types, byteLists, x, y }) => {
      const files = names.map((name, i) => new File([new Uint8Array(byteLists[i])], name, { type: types[i] }));
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      const target = document.elementFromPoint(x, y) ?? document.body;
      const make = (type: string) =>
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: x,
          clientY: y,
        });
      target.dispatchEvent(make('dragenter'));
      target.dispatchEvent(make('dragover'));
      target.dispatchEvent(make('drop'));
    },
    {
      names: files.map((f) => f.name),
      types: files.map((f) => f.type),
      byteLists: files.map((f) => Array.from(f.bytes)),
      x,
      y,
    },
  );
}
