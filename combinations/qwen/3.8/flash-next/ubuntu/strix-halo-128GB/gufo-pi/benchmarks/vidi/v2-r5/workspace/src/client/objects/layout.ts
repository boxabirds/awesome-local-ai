/**
 * Sticky note layout constants, in board units (they scale with zoom). Presentation details
 * that are not product settings: the product settings (note size, colours, text limit, font
 * range) live in `src/shared/config.ts`.
 */

import { STICKY_SIZE_WORLD } from '../../shared/config';

/** Text inset from each edge of a note, in board units. */
export const NOTE_PADDING = 14;

/** Space the text has to itself inside a note: `STICKY_SIZE_WORLD` minus both insets. */
export const NOTE_INNER_SIZE = STICKY_SIZE_WORLD - 2 * NOTE_PADDING;

/**
 * Box the editor is measured against. The textarea's own box is the whole note and its
 * `scrollHeight` includes its padding, unlike the display element's inner box.
 */
export const NOTE_EDITOR_BOX = STICKY_SIZE_WORLD;

/** Text line height as a multiple of the font size. */
export const NOTE_LINE_HEIGHT_FACTOR = 1.35;

/** Height of the bottom fade that marks clipped text, in board units. */
export const NOTE_FADE_SIZE = 28;

/** Height of the character counter strip, in board units. */
export const NOTE_COUNTER_SIZE = 18;
