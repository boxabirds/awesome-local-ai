/**
 * Realistic text fixtures for story 2 tests (unit and e2e). English prose,
 * not repeated single characters (which lay out unrealistically).
 */

/** A short brainstorm phrase. */
export const SHORT_PHRASE = "Faster onboarding";

/** A three-line retro item (~120 chars). */
export const RETRO_ITEM =
  "What went well: the demo went smoothly.\n" +
  "What did not: build times grew again.\n" +
  "Action: profile the bundler this week.";

/** A 1,000 character paragraph of English prose. */
export const LONG_PARAGRAPH =
  "Sticky notes are the most basic unit of a whiteboard. A team jots an idea " +
  "down the moment it appears, moves it next to related ideas as the thinking " +
  "evolves, and uses colour to separate themes, owners or votes. The tool " +
  "should feel as fast as writing on paper: create a note with a double-click, " +
  "type without ceremony, drag the note anywhere on the board, and delete the " +
  "ones that turn out to be wrong or duplicated. Text that grows longer should " +
  "shrink to stay readable inside the note, and when it no longer fits, the " +
  "overflow is hidden behind a soft fade so the note keeps its shape. None of " +
  "this should fight the user: every action must be immediate, available to " +
  "people who work with a keyboard alone, and fast enough to keep up with a " +
  "conversation about the board. A board full of short notes reads like a wall " +
  "of paper in a busy office, and that is exactly the feeling the product " +
  "should give. Ideas are cheap, so the cost of creating one must be small, " +
  "and the cost of moving it even smaller.";

/** More prose so `proseOf` can reach lengths beyond LONG_PARAGRAPH. */
const PROSE_TAIL =
  " The same goes for colour: choosing it must be a glance, not a menu dive. " +
  "And deletion should feel as light as peeling a note off a wall: one key, " +
  "no confirmation, no ceremony. If any of those actions takes more than a " +
  "blink, the board stops feeling like paper and starts feeling like software, " +
  "and that is the exact feeling the design is trying to avoid.";

const PROSE = LONG_PARAGRAPH + PROSE_TAIL;

/**
 * Deterministic English prose of exactly `chars` characters, taken from the
 * start of the fixture prose (no repeated single characters).
 */
export function proseOf(chars: number): string {
  if (chars <= LONG_PARAGRAPH.length) return LONG_PARAGRAPH.slice(0, chars);
  return PROSE.slice(0, chars);
}
