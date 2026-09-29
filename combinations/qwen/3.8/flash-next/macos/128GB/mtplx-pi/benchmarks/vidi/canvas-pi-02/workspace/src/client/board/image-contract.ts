/**
 * The image contract (story 12): the two named constants, the shared
 * placeholder key, and the row-placement rule.
 *
 * Everything here is pure and lives on the client side of the line: the
 * constants exist because the design names them ("the image contract"), and
 * the placement rule is the single function every insert path — drop, paste,
 * and the picker — goes through, so "the row a paste lands in is computed by
 * the same function as the row a drop does" is true by construction.
 */

/** Upload limit: 12 MiB. (The draft's 50 MB was the typo, design §contract.) */
export const IMAGE_MAX_BYTES = 12 * 1024 * 1024;

/** Row layout mode. (The draft's "centre" spelling was the typo.) */
export const IMAGE_LAYOUT: 'replace' = 'replace';

/** Horizontal gap between row slots, world units. */
export const IMAGE_ROW_GAP = 20;

/**
 * One already-placed image's footprint, for the slot lookup: the x-range it
 * covers and its bottom edge (its "y1").
 */
export interface PlacedFootprint {
  x0: number;
  x1: number;
  y1: number;
}

/** A rect the row rule hands back: a top-left corner and a size. */
export interface PlacedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The row slot for the x-range `[x0, x1]`: the deepest placed image whose
 * x-range overlaps that range, or `0` when nothing does. An empty board has
 * no overlap, so the first slot of the first drop starts its top edge at
 * `y = 0`; a slot over the 500-tall image that sits at `y = 300` starts at
 * `y = 800` — images land *below* everything their row touches, never on
 * top of it (design §"Image placement", the two worked examples).
 */
export function imageRowSlotY(
  placed: readonly PlacedFootprint[],
  x0: number,
  x1: number,
): number {
  let y = 0;
  for (const footprint of placed) {
    if (footprint.x1 > x0 && footprint.x0 < x1 && footprint.y1 > y) {
      y = footprint.y1;
    }
  }
  return y;
}

/**
 * Lay one insert batch out as a row, left to right, in the order the files
 * arrived.
 *
 * The first slot starts at `firstX` — the drop point's x for a drop, or the
 * centred start for a paste/picker — and every later slot begins one image
 * width plus `IMAGE_ROW_GAP` (20) to the right of the previous slot's
 * start plus width. Each slot's y comes from `imageRowSlotY`, computed
 * against everything already on the board *and* the slots already placed in
 * this batch, so a row crossing the tall image in the middle of the board
 * walks down underneath it, and an empty board keeps the whole row at 0.
 */
export function placeImageRow(
  sizes: readonly { width: number; height: number }[],
  firstX: number,
  placed: readonly PlacedFootprint[],
): PlacedRect[] {
  const rects: PlacedRect[] = [];
  const row = [...placed];
  let x = firstX;
  for (const size of sizes) {
    const y = imageRowSlotY(row, x, x + size.width);
    rects.push({ x, y, width: size.width, height: size.height });
    row.push({ x0: x, x1: x + size.width, y1: y + size.height });
    x += size.width + IMAGE_ROW_GAP;
  }
  return rects;
}

/**
 * Total width a batch would occupy, gaps included — the centred paths use it
 * to find `firstX` without duplicating the gap rule.
 */
export function imageRowWidth(sizes: readonly { width: number }[]): number {
  let width = IMAGE_ROW_GAP * Math.max(0, sizes.length - 1);
  for (const size of sizes) width += size.width;
  return width;
}
