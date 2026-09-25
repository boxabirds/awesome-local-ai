import { PRESENCE_COLORS } from '../../shared/config';

/**
 * The colour palette, and the two mappings around it (story 6, task 11).
 *
 * A colour is only worth having if it says *who*. With five people on a board and
 * eight colours in the palette, five different colours is therefore not a nicety:
 * it is the requirement.
 *
 * ## What this file is not
 *
 * It is not where the choice is made. Which colour a person is drawn in is settled
 * by one pass over the whole board — `distinguish` in `people.ts` — because five
 * browsers picking a colour before any of them has seen another cannot be untangled
 * by a rule each one applies on its own. An earlier version of this file held
 * exactly such a rule (keep your colour unless a *lower client id* is wearing it,
 * otherwise take the first free one in a rotation started at your own id), and it
 * is worth keeping the reason it was removed rather than only the removal: five
 * blinds flee the same colour in the same step and land together on the next one,
 * so a board spends its time swinging between two arrangements of colours for as
 * long as anybody moves a mouse. A per-browser rule has nothing to break a tie
 * with, because five people who arrive at once genuinely did pick the same thing.
 * A single pass over the set does have a tie-breaker — the client id order — and
 * it is applied once, to everybody, which is why it can be *shown* to settle
 * instead of hoped to.
 *
 * ## Why the palette is allowed to run out
 *
 * Past eight people colours repeat, spread from each person's own place in the
 * palette rather than stacked on one colour. That is a decision rather than a
 * limit: the alternative is a ninth person arriving to *no* colour, which tells
 * the other eight nothing about who is new. A repeated colour plus a different
 * name still identifies somebody; a grey blob does not.
 */

/** Is this colour one of ours? Anything from outside is not a claim on a slot. */
export function inPalette(color: string): boolean {
  return (PRESENCE_COLORS as readonly string[]).includes(color);
}
