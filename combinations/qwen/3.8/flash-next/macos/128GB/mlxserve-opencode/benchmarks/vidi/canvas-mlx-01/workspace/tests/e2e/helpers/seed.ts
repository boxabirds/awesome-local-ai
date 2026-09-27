/**
 * Extra story-4 e2e helpers: seed many notes through the running client's own Y.Doc in a
 * single transaction (so they persist as one change), and drive the room's test-only storage
 * corrupt/repair endpoint (enabled only when the dev server runs with `TEST_HOOKS=1`).
 */
import type { Page } from '@playwright/test';

/**
 * Create `count` sticky notes on the live board inside one client transaction. Each note is a
 * real shared Y.Map with a real YText body (constructors taken from the document's own
 * instances), so it propagates and persists exactly like a hand-created note — just in bulk.
 */
export function seedNotes(page: Page, count: number): Promise<void> {
  return page.evaluate((n) => {
    const doc: any = (window as unknown as { __vidi6: { getDoc(): any } }).__vidi6.getDoc();
    const objects: any = doc.getMap('objects');
    const YMap = Object.getPrototypeOf(objects).constructor;
    // A real YText constructor, taken from the first note the client already made.
    const existing: any[] = Array.from(objects.values() as Iterable<unknown>);
    const sample: any = existing.find((m) => m && typeof m.get === 'function' && m.get('text'));
    if (!sample) throw new Error('seedNotes: create one note through the toolbar first');
    const YText = Object.getPrototypeOf(sample.get('text')).constructor;
    doc.transact(() => {
      for (let i = 0; i < n; i++) {
        const m = new YMap();
        m.set('type', 'sticky');
        m.set('x', (i % 50) * 400);
        m.set('y', Math.floor(i / 50) * 400);
        m.set('color', 'yellow');
        m.set('z', i);
        m.set('text', new YText(`note ${i}`));
        objects.set(`bulk-${i}`, m);
      }
    });
  }, count);
}

/** POST the room's test-only storage operation for `boardId` (`corrupt` | `repair`). */
export async function boardStorageOp(
  base: string,
  boardId: string,
  op: 'corrupt' | 'repair',
): Promise<number> {
  const res = await fetch(`${base}/__test/board/${boardId}/${op}`, { method: 'POST' });
  return res.status;
}
