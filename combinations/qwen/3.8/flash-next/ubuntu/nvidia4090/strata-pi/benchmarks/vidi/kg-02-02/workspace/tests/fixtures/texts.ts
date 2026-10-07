/**
 * Realistic note text fixtures used by unit, component and e2e tests.
 * The long fixture is English prose (not a repeated character), because text
 * that lays out unrealistically hides layout bugs.
 */

export const SHORT_NOTE_TEXT = "Faster onboarding";

/** Three-line retro item, ~95 characters. */
export const RETRO_NOTE_TEXT = [
  "What went well:",
  "- pairing on the camera maths",
  "- shipping the demo with real data",
].join("\n");

export const LONG_PROSE =
  "The team agreed that the retrospective should start with three minutes of silent writing, because " +
  "the loudest voices otherwise set the agenda before anyone has had a chance to think. Faster " +
  "onboarding came up again: new people spend their first week hunting for the right channel, the " +
  "right document and the right person to ask, and that week is never recovered. Several notes argued " +
  "for a short welcome page listing the first five things to read and the first five people to talk " +
  "to. Another group wanted every demo to run on real data, even messy data, because a polished demo " +
  "teaches the room nothing about what the product does on an ordinary Tuesday afternoon. We also " +
  "noticed that our planning board has become a graveyard of ideas that were never grouped, recoloured " +
  "or removed, which is a polite way of saying that nobody felt safe deleting anything. The action for " +
  "the next sprint is small on purpose: pick one board, one colour scheme and one hour where the whole " +
  "team moves notes together and talks out loud about what each colour means. If that hour feels useful " +
  "we will repeat it every month and write down what actually changed in the board. Two people asked " +
  "whether colours should mean the same thing on every board, and we agreed to try one shared meaning " +
  "for a month before arguing about the details.";

/** Exactly `n` characters of the prose fixture. */
export function proseOfLength(n: number): string {
  return LONG_PROSE.slice(0, n);
}

export const PROSE_1000 = proseOfLength(1000);
export const PROSE_1200 = proseOfLength(1200);
