/**
 * E2E text fixtures: long texts with known lengths for the sticky note
 * limit tests. Lengths are part of the contract: assert them at the point of
 * use so a future edit of the prose cannot silently change a boundary test.
 */

/** Realistic prose of exactly 1000 characters (the note limit boundary). */
export const EXACTLY_1000_CHARS = `Capturing ideas on a shared board changes how a team thinks together. The first step is deliberately small: a single note, a sentence or two, no pressure to be right. What follows is the interesting part. Notes multiply, cluster, drift apart, and the shape that emerges is the team's actual thinking made visible.

We keep the tool honest about what it is. A sticky note is not a document, a ticket, or a canvas layer. It has a place, a colour, a short text, and a depth in the stack. Everything else is ceremony, and ceremony is where momentum goes to die. So the gestures stay few: create, write, move, recolour, delete. Each one works the same at every zoom level, and none ask for a second thought.

Speed matters more than we admit. When the note appears under the pointer, the hand keeps moving. When the text fits without a resize handle, the eyes stay on the work. When the note that matters comes to the front the moment it is touched, the story stays readable. That is what a fast board is.`;
