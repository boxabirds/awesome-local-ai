/**
 * Board fixture for the manual performance run (design Fixtures): 500 notes in a 25×20
 * grid with mixed colours and realistic texts.
 */
import type * as Y from 'yjs';
import { createSticky, getStickyText } from '../../src/shared/board-model';
import { STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from '../../src/shared/config';
import { proseOfLength, RETRO_ITEM, SHORT_PHRASE } from './texts';

export const GRID_COLUMNS = 25;
export const GRID_ROWS = 20;
/** Gap between neighbouring notes, in world units. */
const GAP_WORLD = 40;
const MEDIUM_TEXT_CHARS = 300;

const TEXTS = [SHORT_PHRASE, RETRO_ITEM, proseOfLength(MEDIUM_TEXT_CHARS), 'Ship the beta to five customers'];
const COLOURS = Object.keys(STICKY_COLORS) as StickyColor[];

export function buildBoard500(doc: Y.Doc): string[] {
  const ids: string[] = [];
  const pitch = STICKY_SIZE_WORLD + GAP_WORLD;
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLUMNS; col += 1) {
      const i = row * GRID_COLUMNS + col;
      const id = createSticky(doc, { x: col * pitch, y: row * pitch }, COLOURS[i % COLOURS.length]);
      getStickyText(doc, id)?.insert(0, TEXTS[i % TEXTS.length]!);
      ids.push(id);
    }
  }
  return ids;
}
